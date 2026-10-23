import { describe, expect, it } from 'vitest';
import { calendarPeriods, filterObservations, formatPeriod, parseBundle, statusLabel, toCsv, toggleCountry } from './data';
import type { Indicator, Observation } from './data';

// Synthetic observations are isolated to tests and never shipped as public data.
const observations: Observation[] = [
  { country: 'EE', indicator: 'house_price_index', period: '2024-Q1', value: 101, status: null },
  { country: 'LV', indicator: 'house_price_index', period: '2024-Q1', value: null, status: 'p' },
  { country: 'LT', indicator: 'house_price_index', period: '2024-Q1', value: 102, status: null },
  { country: 'EE', indicator: 'house_price_index', period: '2024-Q2', value: 103, status: null },
];

const indicator: Indicator = {
  code: 'house_price_index', dataset_code: 'prc_hpi_q', name: 'Test index', description: 'Synthetic metadata for a parser test.',
  unit: 'I15_Q', frequency: 'Q', dimensions: { unit: 'I15_Q', purchase: 'TOTAL', freq: 'Q' },
  source_url: 'https://ec.europa.eu/eurostat/', publisher: 'Eurostat', attribution: 'Source: Eurostat',
  source_updated_at: null, retrieved_at: '2026-01-01T12:00:00Z',
};

describe('comparison filtering', () => {
  it('keeps at least two selected countries', () => {
    expect(toggleCountry(['EE', 'LV', 'LT'], 'LT')).toEqual(['EE', 'LV']);
    expect(toggleCountry(['EE', 'LV'], 'LV')).toEqual(['EE', 'LV']);
    expect(toggleCountry(['EE', 'LV'], 'LT')).toEqual(['EE', 'LV', 'LT']);
  });

  it('filters by country and inclusive quarterly range, preserving missing values', () => {
    expect(filterObservations(observations, ['EE', 'LV'], '2024-Q1', '2024-Q1', 'house_price_index')).toEqual(observations.slice(0, 2));
    expect(filterObservations(observations, ['EE', 'LV'], '2024-Q2', '2024-Q2', 'house_price_index')).toEqual([observations[3]]);
  });

  it('includes calendar gaps so the chart can retain missing quarters', () => {
    expect(calendarPeriods('2023-Q4', '2024-Q2', 'Q')).toEqual(['2023-Q4', '2024-Q1', '2024-Q2']);
    expect(calendarPeriods('', '', 'Q')).toEqual([]);
    expect(calendarPeriods('2023', '2025', 'A')).toEqual(['2023', '2024', '2025']);
    expect(calendarPeriods('2025-11', '2026-02', 'M')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(formatPeriod('2026-01')).toBe('Jan 2026');
  });
});

describe('CSV export', () => {
  it('exports exactly the displayed rows with source, unit and flags', () => {
    const csv = toCsv(filterObservations(observations, ['EE', 'LV'], '2024-Q1', '2024-Q1', 'house_price_index'), indicator);
    expect(csv.trim().split('\r\n')).toHaveLength(3);
    expect(csv).toContain('EE,house_price_index,2024-Q1,101,I15_Q,Q,,prc_hpi_q,Eurostat');
    expect(csv).toContain('LV,house_price_index,2024-Q1,,I15_Q,Q,p,prc_hpi_q,Eurostat');
    expect(csv).not.toContain('2024-Q2');
    expect(csv).not.toContain('LT,');
  });

  it('quotes publisher text containing commas and double quotes', () => {
    expect(toCsv([observations[0]], { ...indicator, publisher: 'Test, "publisher"' })).toContain('"Test, ""publisher"""');
  });

  it('preserves observation-specific provenance when present', () => {
    const csv = toCsv([{ ...observations[0], source_url: 'https://example.invalid/test-source', retrieved_at: '2025-12-30T10:00:00Z' }], indicator);
    expect(csv).toContain('https://example.invalid/test-source');
    expect(csv).toContain('2025-12-30T10:00:00Z');
    expect(csv).not.toContain('2026-01-01T12:00:00Z');
    expect(toCsv([{ ...observations[0], retrieved_at: null }], indicator)).not.toContain('2026-01-01T12:00:00Z');
  });

  it('exports only the selected indicator even when passed a mixed collection', () => {
    const other: Observation = { country: 'EE', indicator: 'annual_net_earnings', period: '2024', value: 18000, status: 'b' };
    const csv = toCsv([...observations, other], indicator);
    expect(csv).not.toContain('annual_net_earnings');
    expect(csv.trim().split('\r\n')).toHaveLength(observations.length + 1);
  });
});

describe('export validation', () => {
  const bundle = {
    schema_version: 1, exported_at: null,
    countries: [{ code: 'EE', name: 'Estonia' }, { code: 'LV', name: 'Latvia' }, { code: 'LT', name: 'Lithuania' }],
    indicators: [indicator], observations,
    pipeline: { status: 'success', last_success_at: null },
  };

  it('accepts missing values without replacing them', () => {
    expect(parseBundle(bundle).observations[1].value).toBeNull();
  });

  it('rejects malformed periods and duplicate observations', () => {
    expect(() => parseBundle({ ...bundle, observations: [{ ...observations[0], period: '2024-Q5' }] })).toThrow('unsupported or incomplete');
    expect(() => parseBundle({ ...bundle, observations: [{ ...observations[0], period: '0000-Q1' }] })).toThrow('unsupported or incomplete');
    expect(() => parseBundle({ ...bundle, observations: [observations[0], observations[0]] })).toThrow('unsupported or incomplete');
  });

  it('rejects unsupported frequencies and nonpositive or non-finite indices', () => {
    expect(() => parseBundle({ ...bundle, indicators: [{ ...indicator, frequency: 'M' }] })).toThrow('unsupported or incomplete');
    expect(() => parseBundle({ ...bundle, observations: [{ ...observations[0], value: Number.NaN }] })).toThrow('unsupported or incomplete');
    expect(() => parseBundle({ ...bundle, observations: [{ ...observations[0], value: 0 }] })).toThrow('unsupported or incomplete');
  });

  it('allows distinct indicators for the same country and month, including negative and zero inflation', () => {
    const index: Indicator = { ...indicator, code: 'hicp_index', dataset_code: 'prc_hicp_minr', frequency: 'M', unit: 'Index, 2025=100', dimensions: { freq: 'M', unit: 'I25', coicop18: 'TOTAL' } };
    const rate: Indicator = { ...index, code: 'hicp_annual_change', unit: 'Annual rate of change', dimensions: { ...index.dimensions, unit: 'RCH_A' } };
    const mixed = {
      ...bundle, indicators: [indicator, index, rate],
      observations: [
        ...observations,
        { country: 'EE', indicator: 'hicp_index', period: '2024-01', value: 99, status: null },
        { country: 'EE', indicator: 'hicp_annual_change', period: '2024-01', value: -0.5, status: null },
        { country: 'EE', indicator: 'hicp_annual_change', period: '2024-02', value: 0, status: null },
      ],
    };
    expect(parseBundle(mixed).observations).toHaveLength(7);
    expect(filterObservations(parseBundle(mixed).observations, ['EE', 'LV'], '2024-01', '2024-02', 'hicp_annual_change').map(row => row.value)).toEqual([-0.5, 0]);
    expect(() => parseBundle({ ...mixed, observations: [{ ...mixed.observations[4], period: '2024-13' }] })).toThrow('unsupported or incomplete');
    expect(() => parseBundle({ ...mixed, observations: [{ ...mixed.observations[5], value: -100 }] })).toThrow('unsupported or incomplete');
  });

  it('requires annual earnings periods and retains the source break label', () => {
    const earnings: Indicator = { ...indicator, code: 'annual_net_earnings', frequency: 'A', unit: 'Euro', dimensions: { currency: 'EUR', estruct: 'NET', ecase: 'P1_NCH_AW100' }, status_labels: { b: 'break in time series', p: 'provisional' } };
    const annual = { ...bundle, indicators: [earnings], observations: [{ country: 'EE', indicator: 'annual_net_earnings', period: '2024', value: 18000, status: 'b' }] };
    expect(parseBundle(annual).observations[0].status).toBe('b');
    expect(parseBundle({ ...annual, observations: [{ ...annual.observations[0], value: 0 }] }).observations[0].value).toBe(0);
    expect(() => parseBundle({ ...annual, observations: [{ ...annual.observations[0], value: -1 }] })).toThrow('unsupported or incomplete');
    expect(statusLabel('bp', earnings)).toBe('bp · break in time series; provisional');
    expect(() => parseBundle({ ...annual, observations: [{ ...annual.observations[0], period: '2024-Q1' }] })).toThrow('unsupported or incomplete');
  });

  it.each([
    { code: 'median_equivalised_income', frequency: 'A', unit: 'Euro', period: '2024', value: 0, invalid: -1 },
    { code: 'household_consumption_expenditure', frequency: 'A', unit: 'Current prices, million euro', period: '2024', value: 12000, invalid: -1 },
    { code: 'household_consumption_volume', frequency: 'A', unit: 'Chain linked volumes, index 2020=100', period: '2024', value: 105, invalid: 0 },
    { code: 'housing_cost_overburden', frequency: 'A', unit: 'Percentage', period: '2024', value: 0, invalid: 101 },
    { code: 'household_price_level', frequency: 'A', unit: 'Price level indices (EU27_2020=100)', period: '2024', value: 85, invalid: 0 },
    { code: 'rent_price_index', frequency: 'M', unit: 'Index, 2025=100', period: '2024-01', value: 95, invalid: 0 },
    { code: 'mortgage_borrowing_rate', frequency: 'M', unit: 'Percent per annum', period: '2024-01', value: -0.1, invalid: -100 },
  ] as const)('validates $code according to its statistical measure', ({ code, frequency, unit, period, value, invalid }) => {
    const metadata: Indicator = { ...indicator, code, frequency, unit, comparison_kind: ['housing_cost_overburden', 'mortgage_borrowing_rate'].includes(code) ? 'percentage_points' : 'index' };
    const expanded = { ...bundle, indicators: [metadata], observations: [{ country: 'EE', indicator: code, period, value, status: null }] };
    expect(parseBundle(expanded).observations[0].value).toBe(value);
    expect(() => parseBundle({ ...expanded, observations: [{ ...expanded.observations[0], value: invalid }] })).toThrow('unsupported or incomplete');
  });
});
