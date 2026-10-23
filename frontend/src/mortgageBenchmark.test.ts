import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataBundle, Indicator, Observation } from './data';
import { mortgageBenchmark } from './mortgageBenchmark';

function testBundle(): DataBundle {
  // Invented rates stay in this test fixture, separate from official public data.
  const indicator: Indicator = {
    code: 'mortgage_borrowing_rate', dataset_code: 'MIR', name: 'Test borrowing benchmark',
    description: 'Synthetic metadata for selection tests.', unit: 'Percent per annum', frequency: 'M',
    dimensions: { freq: 'M', unit: 'PCPA', bs_rep_sector: 'B', bs_item: 'A2C', maturity_not_irate: 'AM',
      data_type_mir: 'R', amount_cat: 'A', bs_count_sector: '2250', currency_trans: 'EUR', ir_bus_cov: 'N' },
    publisher: 'ECB', source_url: 'https://data.ecb.europa.eu/data/datasets/MIR', attribution: 'Test only',
    source_updated_at: '2026-10-01T08:00:00Z', retrieved_at: '2026-10-01T09:00:00Z',
    status_labels: { A: 'Normal value', P: 'Provisional value', R: 'Revised value', E: 'Estimated value',
      F: 'Forecast value', B: 'Time series break', U: 'Low reliability', M: 'Missing value; data cannot exist' },
    latest_attempt: { status: 'success', started_at: '2026-10-01T09:00:00Z', finished_at: '2026-10-01T09:01:00Z', error: null },
  };
  const observation = (period: string, value: number, country: 'LV' | 'EE' = 'LV'): Observation => ({
    indicator: 'mortgage_borrowing_rate', country, period, value, status: 'A', dimensions: { ...indicator.dimensions },
    source_url: 'https://data-api.ecb.europa.eu/service/data/MIR/M.EE+LV+LT.B.A2C.AM.R.A.2250.EUR.N?format=csvdata',
    retrieved_at: '2026-10-01T09:00:00Z', source_updated_at: '2026-10-01T08:00:00Z',
  });
  return {
    schema_version: 1, exported_at: '2026-10-01T09:01:00Z',
    countries: [{ code: 'EE', name: 'Estonia' }, { code: 'LV', name: 'Latvia' }, { code: 'LT', name: 'Lithuania' }],
    indicators: [indicator],
    observations: [observation('2026-08', 4.1), observation('2026-09', 3.8, 'EE'), observation('2026-07', 3.9)],
    pipeline: { status: 'success', last_success_at: '2026-10-01T09:01:00Z' },
  };
}

describe('official mortgage benchmark context', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('selects the latest chronological observation only for the chosen country without converting it', () => {
    const data = testBundle();
    const before = JSON.stringify(data);
    const result = mortgageBenchmark(data, 'LV');
    expect(result).toMatchObject({ status: 'available', value: 4.1, period: '2026-08', flag: 'A',
      retrieved_at: '2026-10-01T09:00:00Z', source_url: data.observations[0].source_url, reason: null });
    expect(result.notes.join(' ')).toContain('not a nominal annual contract rate');
    expect(result.notes.join(' ')).toContain('A (Normal value)');
    expect(result.notes.join(' ')).toContain('Latest observation in the loaded snapshot');
    expect(JSON.stringify(data)).toBe(before);
  });

  it('explains unloaded data, absent metadata and missing country coverage', () => {
    expect(mortgageBenchmark(undefined, 'LV').reason).toContain('not loaded');
    expect(mortgageBenchmark({ ...testBundle(), indicators: [] }, 'LV').status).toBe('unavailable');
    expect(mortgageBenchmark(testBundle(), 'LT').reason).toContain('selected country');
  });

  it('does not use an older nonmissing value when the latest observation is missing', () => {
    const data = testBundle();
    data.observations[0].value = null;
    data.observations[0].status = 'M';
    const result = mortgageBenchmark(data, 'LV');
    expect(result).toMatchObject({ status: 'unavailable', value: null, period: '2026-08', flag: 'M' });
    expect(result.reason).toContain('earlier rate is not substituted');
    expect(result.notes.join(' ')).toContain('Missing value');
  });

  it.each(['2026-13', '2026-Q3', '0000-01', 'not-a-month'])('rejects malformed periods instead of guessing the latest month: %s', period => {
    const data = testBundle();
    data.observations[0].period = period;
    expect(mortgageBenchmark(data, 'LV').status).toBe('unavailable');
  });

  it('rejects a future latest month without falling back to the previous observation', () => {
    const data = testBundle();
    data.observations[0].period = '2026-11';
    expect(mortgageBenchmark(data, 'LV')).toMatchObject({ status: 'unavailable', period: '2026-11', value: null });
    expect(mortgageBenchmark(data, 'LV').reason).toContain('future month');
  });

  it('rejects duplicate observations for the latest month', () => {
    const data = testBundle();
    data.observations.push({ ...data.observations[0] });
    expect(mortgageBenchmark(data, 'LV').reason).toContain('duplicate');
  });

  it.each(['F', 'B', 'U', 'X', null])('rejects an unsupported latest flag without an older fallback: %s', status => {
    const data = testBundle();
    data.observations[0].status = status;
    expect(mortgageBenchmark(data, 'LV')).toMatchObject({ status: 'unavailable', value: null, period: '2026-08', flag: status });
  });

  it.each(['P', 'R', 'E'])('retains a published qualified value and explains its official flag: %s', status => {
    const data = testBundle();
    data.observations[0].status = status;
    const result = mortgageBenchmark(data, 'LV');
    expect(result.status).toBe('available');
    expect(result.notes.join(' ')).toContain(data.indicators[0].status_labels![status]);
  });

  it('requires the verified status meaning rather than treating any nonempty flag as valid', () => {
    const data = testBundle();
    data.indicators[0].status_labels!.A = 'Forecast value';
    expect(mortgageBenchmark(data, 'LV').status).toBe('unavailable');
  });

  it.each([
    { publisher: 'Eurostat' }, { dataset_code: 'BSI' }, { frequency: 'Q' as const }, { unit: 'Percentage' },
    { source_url: 'https://example.invalid/MIR' },
  ])('rejects incompatible indicator metadata: %j', change => {
    const data = testBundle();
    Object.assign(data.indicators[0], change);
    expect(mortgageBenchmark(data, 'LV').status).toBe('unavailable');
  });

  it('checks both indicator and observation dimensions, including effective-rate type and unit', () => {
    const data = testBundle();
    data.indicators[0].dimensions.data_type_mir = 'C';
    expect(mortgageBenchmark(data, 'LV').status).toBe('unavailable');
    const other = testBundle();
    other.observations[0].dimensions!.unit = 'PC';
    expect(mortgageBenchmark(other, 'LV').reason).toContain('dimensions');
    delete other.observations[0].dimensions;
    expect(mortgageBenchmark(other, 'LV').status).toBe('unavailable');
  });

  it.each([
    'https://data-api.ecb.europa.eu/service/data/MIR/M.EE.B.A2C.AM.R.A.2250.EUR.N',
    'https://data-api.ecb.europa.eu/service/data/MIR/M.LV.B.A2C.A.R.A.2250.EUR.N',
    'http://data-api.ecb.europa.eu/service/data/MIR/M.LV.B.A2C.AM.R.A.2250.EUR.N',
    'https://data-api.ecb.europa.eu.example.invalid/service/data/MIR/M.LV.B.A2C.AM.R.A.2250.EUR.N',
  ])('rejects an unverified observation source: %s', source_url => {
    const data = testBundle();
    data.observations[0].source_url = source_url;
    expect(mortgageBenchmark(data, 'LV')).toMatchObject({ status: 'unavailable', source_url: null });
  });

  it.each([null, undefined, '2026-02-30T00:00:00Z', '2026-10-24T00:00:00Z', '2026-07-31T23:59:59Z'])('rejects missing or inconsistent observation retrieval metadata: %s', retrieved_at => {
    const data = testBundle();
    data.observations[0].retrieved_at = retrieved_at;
    expect(mortgageBenchmark(data, 'LV').status).toBe('unavailable');
  });

  it('keeps original observation retrieval separate from newer series retrieval metadata', () => {
    const data = testBundle();
    data.observations[0].retrieved_at = '2026-09-15T10:00:00Z';
    const result = mortgageBenchmark(data, 'LV');
    expect(result).toMatchObject({ status: 'available', retrieved_at: '2026-09-15T10:00:00Z' });
    expect(result.notes.join(' ')).toContain('retains its original retrieval time');
  });

  it('does not invent an age threshold that turns an old loaded observation into a current market rate', () => {
    const data = testBundle();
    data.observations = [{ ...data.observations[0], period: '2020-01', retrieved_at: '2020-02-15T00:00:00Z' }];
    const result = mortgageBenchmark(data, 'LV');
    expect(result).toMatchObject({ status: 'available', period: '2020-01' });
    expect(result.notes.join(' ')).toContain('newer releases may exist');
  });

  it('identifies a failed series refresh without hiding the previously verified snapshot', () => {
    const data = testBundle();
    data.indicators[0].latest_attempt!.status = 'failed';
    const result = mortgageBenchmark(data, 'LV');
    expect(result.status).toBe('available');
    expect(result.notes.join(' ')).toContain('latest refresh of this ECB series failed');
  });

  it('does not confuse an unrelated pipeline failure with an ECB refresh failure', () => {
    const data = testBundle();
    data.pipeline.latest_attempt = { ...data.indicators[0].latest_attempt!, status: 'failed' };
    expect(mortgageBenchmark(data, 'LV').notes.join(' ')).not.toContain('failed');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -100])('rejects invalid latest rate values: %s', value => {
    const data = testBundle();
    data.observations[0].value = value;
    expect(mortgageBenchmark(data, 'LV').status).toBe('unavailable');
  });

  it('retains a negative published statistical rate without making it a calculator input', () => {
    const data = testBundle();
    data.observations[0].value = -0.1;
    expect(mortgageBenchmark(data, 'LV')).toMatchObject({ status: 'available', value: -0.1 });
  });

  it('accepts the existing real committed snapshot for every Baltic country', () => {
    const data = JSON.parse(readFileSync('public/data/observations.json', 'utf8')) as DataBundle;
    for (const country of ['EE', 'LV', 'LT'] as const) {
      const result = mortgageBenchmark(data, country);
      expect(result.status).toBe('available');
      expect(result.period).toBe('2026-08');
      expect(result.flag).toBe('A');
    }
  });
});
