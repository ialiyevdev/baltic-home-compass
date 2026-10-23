import type { CountryCode, DataBundle } from './data';

export interface MortgageBenchmark {
  status: 'available' | 'unavailable';
  value: number | null;
  period: string | null;
  retrieved_at: string | null;
  source_url: string | null;
  flag: string | null;
  reason: string | null;
  notes: string[];
}

const dimensions = {
  freq: 'M', unit: 'PCPA', bs_rep_sector: 'B', bs_item: 'A2C', maturity_not_irate: 'AM',
  data_type_mir: 'R', amount_cat: 'A', bs_count_sector: '2250', currency_trans: 'EUR', ir_bus_cov: 'N',
};
const publishedStatuses: Record<string, string> = {
  A: 'Normal value', P: 'Provisional value', R: 'Revised value', E: 'Estimated value',
};

function sameDimensions(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const codes = value as Record<string, unknown>;
  return Object.keys(codes).length === Object.keys(dimensions).length
    && Object.entries(dimensions).every(([key, code]) => codes[key] === code);
}

function mirSource(value: string | undefined, country: CountryCode, allowDataset = false): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
    const pathname = decodeURIComponent(url.pathname).replace(/\/$/, '');
    if (url.hostname === 'data.ecb.europa.eu') {
      return allowDataset && pathname === '/data/datasets/MIR'
        || pathname === `/data/datasets/MIR/MIR.M.${country}.B.A2C.AM.R.A.2250.EUR.N`;
    }
    if (url.hostname !== 'data-api.ecb.europa.eu') return false;
    const match = /^\/service\/data\/MIR\/M\.([A-Z+]+)\.B\.A2C\.AM\.R\.A\.2250\.EUR\.N$/.exec(pathname);
    if (!match) return false;
    const countries = match[1].split('+');
    return countries.includes(country) && new Set(countries).size === countries.length
      && countries.every(code => ['EE', 'LV', 'LT'].includes(code));
  } catch {
    return false;
  }
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^([1-9]\d{3})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!match || Number(match[3]) > new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)).getUTCDate()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export function mortgageBenchmark(data: DataBundle | undefined, country: CountryCode): MortgageBenchmark {
  const result: MortgageBenchmark = {
    status: 'unavailable', value: null, period: null, retrieved_at: null,
    source_url: null, flag: null, reason: null,
    notes: ['Statistical context only: AAR/NDER is not a nominal annual contract rate or a personal bank offer.'],
  };
  const unavailable = (reason: string): MortgageBenchmark => ({ ...result, reason });
  if (!data) return unavailable('Official benchmark data is not loaded. Enter your nominal annual rate manually.');
  if (data.pipeline.status !== 'success') return unavailable('No successfully ingested official snapshot is available.');
  const definitions = data.indicators.filter(item => item.code === 'mortgage_borrowing_rate');
  if (definitions.length !== 1) return unavailable('The loaded snapshot does not identify one ECB borrowing-cost series.');
  const indicator = definitions[0];
  if (indicator.publisher !== 'ECB' || indicator.dataset_code !== 'MIR' || indicator.frequency !== 'M'
    || indicator.unit !== 'Percent per annum' || !sameDimensions(indicator.dimensions)
    || !mirSource(indicator.source_url, country, true)) {
    return unavailable('The borrowing-cost metadata does not match the verified ECB MIR definition.');
  }
  if (indicator.latest_attempt?.status === 'failed') {
    result.notes.push('The latest refresh of this ECB series failed. The loaded observation may not be the newest publication.');
  } else if (indicator.latest_attempt?.status === 'running') {
    result.notes.push('A refresh of this ECB series is in progress; this value belongs to the loaded snapshot.');
  }
  const rows = data.observations.filter(row => row.indicator === 'mortgage_borrowing_rate' && row.country === country);
  if (!rows.length) return unavailable('No ECB borrowing-cost observation is present for the selected country.');
  if (rows.some(row => !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(row.period))) {
    return unavailable('The series contains an invalid month, so its latest observation cannot be verified.');
  }
  const latestPeriod = rows.map(row => row.period).sort().at(-1)!;
  const latest = rows.filter(row => row.period === latestPeriod);
  result.period = latestPeriod;
  if (latest.length !== 1) return unavailable('The latest month has duplicate observations and cannot be verified.');
  const row = latest[0];
  result.flag = typeof row.status === 'string' ? row.status : null;
  const reportedLabel = row.status === null ? undefined : indicator.status_labels?.[row.status];
  if (reportedLabel) result.notes.push(`Official observation status: ${row.status} (${reportedLabel}).`);
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  if (latestPeriod > currentMonth) return unavailable('The latest observation is dated in a future month.');
  if (!sameDimensions(row.dimensions)) return unavailable('The latest observation has missing or incompatible series dimensions.');
  if (!mirSource(row.source_url, country)) return unavailable('The latest observation does not identify the verified official ECB series.');
  result.source_url = row.source_url!;
  const retrieved = timestamp(row.retrieved_at);
  if (retrieved === null || retrieved > now.getTime()) {
    return unavailable('The latest observation has a missing, invalid or future retrieval timestamp.');
  }
  result.retrieved_at = row.retrieved_at!;
  const periodStart = Date.UTC(Number(latestPeriod.slice(0, 4)), Number(latestPeriod.slice(5)) - 1, 1);
  if (retrieved < periodStart) return unavailable('The recorded retrieval predates the observation month and cannot verify this value.');
  if (row.value === null) return unavailable('The latest month has no published value; an earlier rate is not substituted.');
  if (typeof row.value !== 'number' || !Number.isFinite(row.value) || row.value <= -100) {
    return unavailable('The latest observation is not a valid borrowing rate in percent per annum.');
  }
  const label = row.status === null ? undefined : publishedStatuses[row.status];
  if (!label || indicator.status_labels?.[row.status!] !== label) {
    return unavailable('The latest observation has an unsupported or unverified ECB status; an earlier rate is not substituted.');
  }
  result.notes.push('Latest observation in the loaded snapshot; this is not a live rate and newer releases may exist.');
  const seriesRetrieved = timestamp(indicator.retrieved_at);
  if (indicator.retrieved_at !== null && (seriesRetrieved === null || seriesRetrieved > now.getTime())) {
    return unavailable('The series retrieval metadata is invalid or dated in the future.');
  }
  if (seriesRetrieved !== null && seriesRetrieved > retrieved) {
    result.notes.push('This observation retains its original retrieval time, which predates a later series retrieval.');
  }
  return { ...result, status: 'available', value: row.value, reason: null };
}
