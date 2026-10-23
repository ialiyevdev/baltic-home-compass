import type { CountryCode } from './data';

export interface MortgageInput {
  spec_version: '1';
  country: CountryCode;
  property_price: number;
  down_payment: { mode: 'amount' | 'percent'; value: number };
  annual_rate: number;
  term_years: number;
  monthly_property_expenses: number;
  one_time_costs: number;
  monthly_income: number | null;
  monthly_debts: number;
  monthly_living_expenses: number;
  housing_threshold: number;
  desired_monthly_payment: number;
  rate_offsets: number[];
}

export interface ScheduleRow {
  month: number;
  payment: number;
  principal: number;
  interest: number;
  balance: number;
  cumulative_interest: number;
}

export interface AnnualRow extends Omit<ScheduleRow, 'month'> { year: number }

export interface MortgageResult {
  property_price: number;
  down_payment: number;
  loan_principal: number;
  loan_to_value: number | null;
  number_of_payments: number;
  monthly_payment: number;
  total_repayment: number;
  total_interest: number;
  initial_cash: number;
  monthly_housing_outflow: number;
  final_payment: number;
}

export interface AffordabilityResult {
  monthly_income: number | null;
  mortgage_to_income: number | null;
  debt_to_income: number | null;
  housing_to_income: number | null;
  remaining_income: number | null;
  threshold: number;
  threshold_exceeded: boolean | null;
}

export interface ReverseBudget {
  status: 'available' | 'unavailable';
  reason: string | null;
  loan_principal: number | null;
  property_price: number | null;
  down_payment: number | null;
  monthly_payment: number | null;
  total_interest: number | null;
  total_repayment: number | null;
}

export interface RateScenario {
  offset: number;
  annual_rate: number;
  status: 'available' | 'unavailable';
  reason: string | null;
  monthly_payment: number | null;
  payment_difference: number | null;
  total_interest: number | null;
  total_interest_difference: number | null;
  total_repayment: number | null;
  total_repayment_difference: number | null;
  mortgage_to_income: number | null;
  ratio_difference: number | null;
}

export interface CalculatorResult {
  spec_version: '1';
  mortgage: MortgageResult;
  affordability: AffordabilityResult;
  reverse_budget: ReverseBudget;
  rate_scenarios: RateScenario[];
  schedule: ScheduleRow[];
  annual_schedule: AnnualRow[];
}

export class InputError extends Error {
  constructor(public field: string, message: string) { super(message); this.name = 'InputError'; }
}

export class CalculationMismatchError extends Error {
  constructor() { super('The API and browser calculations disagree. Results need verification.'); this.name = 'CalculationMismatchError'; }
}

const inputFields = ['spec_version', 'country', 'property_price', 'down_payment', 'annual_rate', 'term_years',
  'monthly_property_expenses', 'one_time_costs', 'monthly_income', 'monthly_debts', 'monthly_living_expenses',
  'housing_threshold', 'desired_monthly_payment', 'rate_offsets'];

function numeric(value: unknown, field: string, maximum: number, decimals: number, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new InputError(field, 'Enter a finite number.');
  if (value < minimum || value > maximum) throw new InputError(field, `Enter a value between ${minimum} and ${maximum}.`);
  if (Number(value.toFixed(decimals)) !== value) throw new InputError(field, `Use at most ${decimals} decimal places.`);
}

function validate(input: MortgageInput): number {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new InputError('scenario', 'Enter a scenario object.');
  if (Object.keys(input).some(key => !inputFields.includes(key))) throw new InputError('scenario', 'Unknown scenario field.');
  if (input.spec_version !== '1') throw new InputError('spec_version', 'Unsupported calculation specification.');
  if (!['EE', 'LV', 'LT'].includes(input.country)) throw new InputError('country', 'Select Estonia, Latvia or Lithuania.');
  for (const field of ['property_price', 'monthly_property_expenses', 'one_time_costs', 'monthly_debts', 'monthly_living_expenses', 'desired_monthly_payment'] as const) {
    numeric(input[field], field, 1e9, 2);
  }
  if (input.monthly_income !== null) numeric(input.monthly_income, 'monthly_income', 1e9, 2);
  numeric(input.annual_rate, 'annual_rate', 100, 6);
  numeric(input.housing_threshold, 'housing_threshold', 100, 6);
  if (typeof input.term_years !== 'number' || !Number.isFinite(input.term_years) || input.term_years <= 0 || input.term_years > 60) {
    throw new InputError('term_years', 'Use a term from one month to 60 years.');
  }
  const months = Math.round(input.term_years * 12);
  if (months < 1 || Math.abs(months - input.term_years * 12) > 1e-8) throw new InputError('term_years', 'The term must contain a whole number of months.');
  if (!input.down_payment || typeof input.down_payment !== 'object' || Array.isArray(input.down_payment)
    || Object.keys(input.down_payment).some(key => !['mode', 'value'].includes(key))
    || !['amount', 'percent'].includes(input.down_payment.mode)) throw new InputError('down_payment', 'Choose a down payment amount or percentage.');
  const percent = input.down_payment.mode === 'percent';
  numeric(input.down_payment.value, 'down_payment.value', percent ? 100 : 1e9, percent ? 6 : 2);
  if (!percent && input.down_payment.value > input.property_price) throw new InputError('down_payment.value', 'Down payment cannot exceed the purchase price.');
  if (!Array.isArray(input.rate_offsets) || input.rate_offsets.length > 8) throw new InputError('rate_offsets', 'Use at most eight rate differences.');
  for (const offset of input.rate_offsets) {
    numeric(offset, 'rate_offsets', 100, 6, -100);
    if (offset === 0) throw new InputError('rate_offsets', 'The base rate is already included; omit zero.');
  }
  if (new Set(input.rate_offsets).size !== input.rate_offsets.length) throw new InputError('rate_offsets', 'Rate differences must be distinct.');
  return months;
}

const cents = (value: number) => Math.floor(value * 100 + 0.5);
const euros = (value: number) => value / 100;

function downPayment(price: number, input: MortgageInput['down_payment']): number {
  if (input.mode === 'amount') return cents(input.value);
  const numerator = BigInt(price) * BigInt(Math.round(input.value * 1e6));
  return Number((numerator + 50000000n) / 100000000n);
}

function annuityFactor(rate: number, months: number): number {
  const monthly = rate / 1200;
  return monthly === 0 ? months : -Math.expm1(-months * Math.log1p(monthly)) / monthly;
}

function amortize(principal: number, rate: number, months: number) {
  if (principal === 0) return { monthly: 0, interest: 0, total: 0, final: 0, schedule: [] as ScheduleRow[] };
  const microRate = BigInt(Math.round(rate * 1e6));
  const firstInterest = Number((BigInt(principal) * microRate + 600000000n) / 1200000000n);
  const regular = Math.max(Math.floor(principal / annuityFactor(rate, months) + 0.5), firstInterest);
  let balance = principal;
  let cumulative = 0;
  let total = 0;
  const schedule: ScheduleRow[] = [];
  for (let month = 1; month <= months && balance > 0; month++) {
    const interest = Number((BigInt(balance) * microRate + 600000000n) / 1200000000n);
    const payment = month === months ? balance + interest : Math.min(regular, balance + interest);
    const repaid = payment - interest;
    balance -= repaid;
    cumulative += interest;
    total += payment;
    schedule.push({ month, payment: euros(payment), principal: euros(repaid), interest: euros(interest), balance: euros(balance), cumulative_interest: euros(cumulative) });
  }
  return { monthly: regular, interest: cumulative, total, final: cents(schedule.at(-1)?.payment ?? 0), schedule };
}

function annualize(schedule: ScheduleRow[]): AnnualRow[] {
  const annual: AnnualRow[] = [];
  for (let first = 0; first < schedule.length; first += 12) {
    const group = schedule.slice(first, first + 12);
    const last = group.at(-1)!;
    const sum = (field: 'payment' | 'principal' | 'interest') => euros(group.reduce((total, row) => total + cents(row[field]), 0));
    annual.push({ year: first / 12 + 1, payment: sum('payment'), principal: sum('principal'), interest: sum('interest'), balance: last.balance, cumulative_interest: last.cumulative_interest });
  }
  return annual;
}

function reverseBudget(input: MortgageInput, months: number): ReverseBudget {
  const unavailable = (reason: string): ReverseBudget => ({ status: 'unavailable', reason, loan_principal: null, property_price: null, down_payment: null, monthly_payment: null, total_interest: null, total_repayment: null });
  if (input.down_payment.mode === 'percent' && input.down_payment.value === 100) return unavailable('A 100% down payment does not identify a purchase price from a mortgage payment.');
  const supported = Math.floor(cents(input.desired_monthly_payment) * annuityFactor(input.annual_rate, months));
  const price = input.down_payment.mode === 'amount' ? supported + cents(input.down_payment.value)
    : Number(BigInt(supported) * 100000000n / (100000000n - BigInt(Math.round(input.down_payment.value * 1e6))));
  if (!Number.isFinite(price) || price > 1e14 || supported > 1e14) return unavailable('The reverse scenario exceeds the supported EUR 1 trillion output range.');
  const down = downPayment(price, input.down_payment);
  const principal = price - down;
  const loan = amortize(principal, input.annual_rate, months);
  return { status: 'available', reason: null, loan_principal: euros(principal), property_price: euros(price), down_payment: euros(down), monthly_payment: euros(loan.monthly), total_interest: euros(loan.interest), total_repayment: euros(loan.total) };
}

export function calculateMortgage(input: MortgageInput): CalculatorResult {
  const months = validate(input);
  const price = cents(input.property_price);
  const down = downPayment(price, input.down_payment);
  const principal = price - down;
  const loan = amortize(principal, input.annual_rate, months);
  const housing = loan.monthly + cents(input.monthly_property_expenses);
  const income = input.monthly_income === null ? null : cents(input.monthly_income);
  const ratio = (amount: number) => income !== null && income > 0 ? 100 * amount / income : null;
  const mortgageRatio = ratio(loan.monthly);
  const housingRatio = ratio(housing);
  const scenarios = [0, ...input.rate_offsets].map((offset): RateScenario => {
    const rate = (Math.round(input.annual_rate * 1e6) + Math.round(offset * 1e6)) / 1e6;
    if (rate < 0 || rate > 100) return { offset, annual_rate: rate, status: 'unavailable', reason: 'The scenario rate must be between 0% and 100%.', monthly_payment: null, payment_difference: null, total_interest: null, total_interest_difference: null, total_repayment: null, total_repayment_difference: null, mortgage_to_income: null, ratio_difference: null };
    const scenario = offset === 0 ? loan : amortize(principal, rate, months);
    const scenarioRatio = ratio(scenario.monthly);
    return { offset, annual_rate: rate, status: 'available', reason: null, monthly_payment: euros(scenario.monthly), payment_difference: euros(scenario.monthly - loan.monthly), total_interest: euros(scenario.interest), total_interest_difference: euros(scenario.interest - loan.interest), total_repayment: euros(scenario.total), total_repayment_difference: euros(scenario.total - loan.total), mortgage_to_income: scenarioRatio, ratio_difference: scenarioRatio === null || mortgageRatio === null ? null : scenarioRatio - mortgageRatio };
  });
  return {
    spec_version: '1',
    mortgage: { property_price: euros(price), down_payment: euros(down), loan_principal: euros(principal), loan_to_value: price > 0 ? 100 * principal / price : null, number_of_payments: loan.schedule.length, monthly_payment: euros(loan.monthly), total_repayment: euros(loan.total), total_interest: euros(loan.interest), initial_cash: euros(down + cents(input.one_time_costs)), monthly_housing_outflow: euros(housing), final_payment: euros(loan.final) },
    affordability: { monthly_income: input.monthly_income, mortgage_to_income: mortgageRatio, debt_to_income: ratio(loan.monthly + cents(input.monthly_debts)), housing_to_income: housingRatio, remaining_income: income === null ? null : euros(income - housing - cents(input.monthly_debts) - cents(input.monthly_living_expenses)), threshold: input.housing_threshold, threshold_exceeded: housingRatio === null ? null : housingRatio > input.housing_threshold },
    reverse_budget: reverseBudget(input, months),
    rate_scenarios: scenarios,
    schedule: loan.schedule,
    annual_schedule: annualize(loan.schedule),
  };
}

export function equivalentResults(left: unknown, right: unknown): boolean {
  if (typeof left === 'number' && typeof right === 'number') return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-8;
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((item, index) => equivalentResults(item, right[index]));
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const a = left as Record<string, unknown>;
    const b = right as Record<string, unknown>;
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && equivalentResults(a[key], b[key]));
  }
  return false;
}

const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/+$/, '');
export const apiCalculationEnabled = Boolean(apiBase);

export async function checkCalculator(input: MortgageInput, local: CalculatorResult, signal?: AbortSignal): Promise<'matched'> {
  if (!apiBase) return 'matched';
  const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  const response = await fetch(`${apiBase}/api/calculators/mortgage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: requestSignal, cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`The calculator API returned HTTP ${response.status}. Browser results remain available.`);
  const remote: unknown = await response.json();
  if (!equivalentResults(local, remote)) throw new CalculationMismatchError();
  return 'matched';
}
