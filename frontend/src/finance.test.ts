import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { calculateMortgage, CalculationMismatchError, checkCalculator, equivalentResults, InputError } from './finance';
import type { MortgageInput } from './finance';

vi.hoisted(() => { vi.stubEnv('VITE_API_BASE_URL', 'http://127.0.0.1:8000'); });

const root = resolve(process.cwd(), '..');
const references = JSON.parse(readFileSync(resolve(root, 'data/fixtures/mortgage-cases.json'), 'utf8')) as {
  cases: { name: string; input: MortgageInput; expected: Record<string, unknown> }[];
};
const example = references.cases[0].input;
const money = (value: number) => Math.round(value * 100);

afterEach(() => vi.unstubAllGlobals());
afterAll(() => vi.unstubAllEnvs());

describe('independent Decimal reference cases', () => {
  it.each(references.cases)('$name', ({ input, expected }) => {
    const result = calculateMortgage(input);
    for (const [key, value] of Object.entries(expected)) {
      if (key === 'first_payment') expect(result.schedule[0] ?? null).toEqual(value);
      else if (key === 'last_payment') expect(result.schedule.at(-1) ?? null).toEqual(value);
      else expect(result.mortgage[key as keyof typeof result.mortgage]).toEqual(value);
    }
    const { schedule, annual_schedule: annual, mortgage } = result;
    expect(schedule.every(row => row.balance >= 0 && row.principal >= 0)).toBe(true);
    expect(schedule.at(-1)?.balance ?? 0).toBe(0);
    expect(schedule.reduce((sum, row) => sum + money(row.principal), 0)).toBe(money(mortgage.loan_principal));
    expect(schedule.reduce((sum, row) => sum + money(row.interest), 0)).toBe(money(mortgage.total_interest));
    expect(annual.reduce((sum, row) => sum + money(row.payment), 0)).toBe(money(mortgage.total_repayment));
    expect(money(mortgage.total_repayment)).toBe(money(mortgage.loan_principal) + money(mortgage.total_interest));
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });
});

describe('validation and household interpretation', () => {
  it.each([
    ['property_price', -1], ['property_price', 1e9 + 1], ['property_price', 1.001], ['property_price', 1e-9],
    ['property_price', Number.NaN], ['property_price', Number.POSITIVE_INFINITY], ['property_price', true],
    ['annual_rate', -0.1], ['annual_rate', 100.000001], ['annual_rate', 0.0000001], ['annual_rate', '4'],
    ['term_years', 0], ['term_years', 60.1], ['term_years', 0.1], ['monthly_income', -1],
    ['housing_threshold', 101], ['rate_offsets', [0]], ['rate_offsets', [1, 1]], ['rate_offsets', [101]],
    ['rate_offsets', [1, 2, 3, 4, 5, 6, 7, 8, 9]], ['country', 'FI'], ['spec_version', '2'],
    ['monthly_income', undefined], ['unexpected', 1],
  ])('rejects invalid %s=%s', (field, value) => {
    expect(() => calculateMortgage({ ...example, [field]: value } as MortgageInput)).toThrow(InputError);
  });

  it('rejects excessive down payment and fractional cents', () => {
    for (const down_payment of [{ mode: 'percent', value: 100.01 }, { mode: 'amount', value: 150000.01 }, { mode: 'amount', value: 10.001 }]) {
      expect(() => calculateMortgage({ ...example, down_payment } as MortgageInput)).toThrow(InputError);
    }
  });

  it('keeps missing and zero income distinct', () => {
    expect(calculateMortgage(example).affordability.remaining_income).toBeNull();
    const zero = calculateMortgage({ ...example, monthly_income: 0, monthly_debts: 100 }).affordability;
    expect(zero.mortgage_to_income).toBeNull();
    expect(zero.threshold_exceeded).toBeNull();
    expect(zero.remaining_income).toBeLessThan(0);
  });

  it('compares entered total housing outflow to a personal threshold', () => {
    const result = calculateMortgage({ ...example, monthly_income: 2000, monthly_property_expenses: 300, monthly_debts: 100, monthly_living_expenses: 500, housing_threshold: 30 });
    expect(result.affordability.threshold_exceeded).toBe(true);
    expect(result.affordability.housing_to_income).toBeGreaterThan(result.affordability.mortgage_to_income!);
    expect(result.affordability.debt_to_income).toBeGreaterThan(result.affordability.mortgage_to_income!);
    expect(money(result.affordability.remaining_income!)).toBe(200000 - money(result.mortgage.monthly_payment) - 30000 - 10000 - 50000);
  });

  it('marks impossible lower-rate scenarios unavailable without losing the base', () => {
    const result = calculateMortgage({ ...example, annual_rate: 0, rate_offsets: [-1, 1, 2] });
    expect(result.rate_scenarios.map(row => row.status)).toEqual(['available', 'unavailable', 'available', 'available']);
    expect(result.rate_scenarios[1].monthly_payment).toBeNull();
    expect(result.rate_scenarios[2].payment_difference).toBeGreaterThan(0);
  });

  it('has no country-specific financial assumptions', () => {
    const lv = calculateMortgage(example);
    expect(calculateMortgage({ ...example, country: 'EE' })).toEqual(lv);
    expect(calculateMortgage({ ...example, country: 'LT' })).toEqual(lv);
  });
});

describe('inverse calculation', () => {
  it.each(['amount', 'percent'] as const)('agrees with a forward mortgage for %s down payment', mode => {
    const input: MortgageInput = { ...example, down_payment: { mode, value: mode === 'amount' ? 30000 : 20 }, desired_monthly_payment: 700 };
    const reverse = calculateMortgage(input).reverse_budget;
    expect(reverse.status).toBe('available');
    const forward = calculateMortgage({ ...input, property_price: reverse.property_price! });
    expect(forward.mortgage.loan_principal).toBe(reverse.loan_principal);
    expect(forward.mortgage.down_payment).toBe(reverse.down_payment);
    expect(forward.mortgage.total_interest).toBe(reverse.total_interest);
    expect(reverse.monthly_payment).toBeLessThanOrEqual(input.desired_monthly_payment);
    expect(reverse.monthly_payment).toBeGreaterThanOrEqual(input.desired_monthly_payment - 0.01);
  });

  it('explains underdetermined cash purchase and excessive output range', () => {
    expect(calculateMortgage({ ...example, down_payment: { mode: 'percent', value: 100 } }).reverse_budget.status).toBe('unavailable');
    const huge = calculateMortgage({ ...example, down_payment: { mode: 'percent', value: 99.999999 }, desired_monthly_payment: 1e9 });
    expect(huge.reverse_budget.status).toBe('unavailable');
    expect(huge.reverse_budget.property_price).toBeNull();
  });
});

it('matches the Python engine across reference cases and 80 reproducible scenarios, including full schedules', () => {
  let seed = 7729;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const inputs = [...references.cases.map(item => item.input), ...Array.from({ length: 80 }, (_, index): MortgageInput => {
    const price = Math.floor(random() * 5e7) / 100;
    return { ...example, property_price: price,
      down_payment: index % 2 ? { mode: 'percent', value: Math.floor(random() * 99e6) / 1e6 } : { mode: 'amount', value: Math.floor(price * random() * 100) / 100 },
      annual_rate: index % 7 === 0 ? 0 : Math.floor(random() * 20e6) / 1e6,
      term_years: (1 + Math.floor(random() * 720)) / 12,
      monthly_income: index % 3 === 0 ? null : Math.floor(random() * 1e6) / 100,
      monthly_debts: Math.floor(random() * 1e5) / 100,
      monthly_property_expenses: Math.floor(random() * 1e5) / 100,
    };
  })];
  const script = 'import json,sys; from backend.app.mortgage import calculate_mortgage; from backend.app.mortgage_models import MortgageRequest; print(json.dumps([calculate_mortgage(MortgageRequest.model_validate(x)) for x in json.load(sys.stdin)]))';
  const python = process.env.BHC_PYTHON ?? resolve(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const response = execFileSync(python, ['-c', script], { cwd: root, input: JSON.stringify(inputs), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  const results: unknown[] = JSON.parse(response);
  inputs.forEach((input, index) => expect(equivalentResults(calculateMortgage(input), results[index]), `case ${index}`).toBe(true));
});

describe('API verification', () => {
  it('sends financial values in an uncached POST body and checks the complete response', async () => {
    const result = calculateMortgage(example);
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => result });
    vi.stubGlobal('fetch', request);
    await expect(checkCalculator(example, result)).resolves.toBe('matched');
    expect(request).toHaveBeenCalledWith(expect.stringContaining('/api/calculators/mortgage'), expect.objectContaining({ method: 'POST', body: JSON.stringify(example), cache: 'no-store', credentials: 'omit' }));
  });

  it('exposes backend disagreement instead of silently using different results', async () => {
    const local = calculateMortgage(example);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ...local, mortgage: { ...local.mortgage, monthly_payment: local.mortgage.monthly_payment + 0.01 } }) }));
    await expect(checkCalculator(example, local)).rejects.toBeInstanceOf(CalculationMismatchError);
  });

  it('reports a failed API without changing the local result', async () => {
    const local = calculateMortgage(example);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    await expect(checkCalculator(example, local)).rejects.toThrow('HTTP 503');
    expect(local).toEqual(calculateMortgage(example));
  });
});
