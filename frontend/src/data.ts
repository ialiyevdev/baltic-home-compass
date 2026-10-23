export const countries = [
  { code: 'EE', name: 'Estonia', color: '#57758f' },
  { code: 'LV', name: 'Latvia', color: '#a16a47' },
  { code: 'LT', name: 'Lithuania', color: '#28766b' },
] as const;

export type CountryCode = (typeof countries)[number]['code'];
export type IndicatorCode = 'house_price_index' | 'annual_net_earnings' | 'hicp_index' | 'hicp_annual_change'
  | 'median_equivalised_income' | 'household_consumption_expenditure' | 'household_consumption_volume'
  | 'housing_cost_overburden' | 'household_price_level' | 'rent_price_index' | 'mortgage_borrowing_rate';
export type Frequency = 'A' | 'Q' | 'M';

export interface IngestionAttempt {
  status: 'running' | 'success' | 'failed';
  started_at: string;
  finished_at: string | null;
  error: string | null;
}

export const indicatorDetails: Record<IndicatorCode, {
  title: string;
  category: 'Housing' | 'Household economy' | 'Mortgage rates';
  frequency: Frequency;
  valueUnit: string;
  scope: string;
  readingTitle: string;
  reading: string[];
}> = {
  house_price_index: {
    title: 'House price index', category: 'Housing', frequency: 'Q', valueUnit: 'index', scope: 'Total residential property',
    readingTitle: 'A measure of change',
    reading: [
      'This index tracks changes in residential property prices. It does not measure the price of an average home or a square metre.',
      'Index levels compare each country with its own base year. A higher index does not mean homes cost more in that country.',
    ],
  },
  annual_net_earnings: {
    title: 'Annual net earnings', category: 'Household economy', frequency: 'A', valueUnit: 'EUR / year', scope: 'Single person · No children · 100% of average earnings',
    readingTitle: 'A defined earnings case',
    reading: [
      'Annual net earnings for a single person without children earning 100% of average gross earnings, after the taxes and contributions in the selected model case.',
      'This is not the median wage, a typical individual salary, or the income of an actual household. Values are annual EUR, without a monthly conversion.',
    ],
  },
  hicp_index: {
    title: 'Consumer price index', category: 'Household economy', frequency: 'M', valueUnit: 'index', scope: 'HICP · ECOICOP version 2 · Total consumer basket',
    readingTitle: 'A common price index',
    reading: [
      'The Harmonised Index of Consumer Prices tracks the price of a defined consumer basket over time. The reference year is 2025 = 100.',
      'It does not measure a household’s expenses in euros or compare absolute price levels between countries. Personal spending patterns can differ from the basket.',
    ],
  },
  hicp_annual_change: {
    title: 'Annual inflation', category: 'Household economy', frequency: 'M', valueUnit: '% year-on-year', scope: 'HICP · ECOICOP version 2 · Total consumer basket',
    readingTitle: 'Compared with a year earlier',
    reading: [
      'The annual inflation rate compares consumer prices in each month with the same month one year earlier. It is not a month-on-month change or an annual-average rate.',
      'A negative rate means the measured basket cost less than a year earlier. The national basket does not describe every household’s experience.',
    ],
  },
  median_equivalised_income: {
    title: 'Median equivalised income', category: 'Household economy', frequency: 'A', valueUnit: 'EUR / year',
    scope: 'EU-SILC · Median equivalised disposable income · Survey year',
    readingTitle: 'An adjusted income measure',
    reading: [
      'Equivalised disposable income adjusts household income for household size and composition. The median describes the population distribution of this statistical measure.',
      'It is not the income of an actual household or an individual salary. The displayed survey year refers to income from the previous calendar year for these countries.',
    ],
  },
  household_consumption_expenditure: {
    title: 'Household consumption expenditure', category: 'Household economy', frequency: 'A', valueUnit: 'million EUR',
    scope: 'National accounts · Total household final consumption · Current prices',
    readingTitle: 'A national aggregate',
    reading: [
      'Household final consumption expenditure measures the total value of household consumption in the national accounts, at current prices and in million euros.',
      'This is a national aggregate, not spending per person or a household budget. Differences in population and prices affect comparisons of the level.',
    ],
  },
  household_consumption_volume: {
    title: 'Household consumption volume', category: 'Household economy', frequency: 'A', valueUnit: 'index',
    scope: 'National accounts · Total household final consumption · Chain linked volume',
    readingTitle: 'Consumption in volume terms',
    reading: [
      'The published chain linked volume index tracks changes in aggregate household consumption after the national accounts price adjustment. The reference is 2020 = 100.',
      'It is not an amount in euros, spending per person, or a household budget. This is an official volume measure, rather than a consumer-price adjustment made by this app.',
    ],
  },
  housing_cost_overburden: {
    title: 'Housing cost overburden', category: 'Housing', frequency: 'A', valueUnit: '% of population',
    scope: 'Total population · Housing costs above 40% of disposable income',
    readingTitle: 'Housing cost pressure',
    reading: [
      'The share of people living in households where total housing costs exceed 40% of disposable income. Housing costs and income are measured net of housing allowances.',
      'This population indicator does not estimate what an individual household can afford, and it is not the average share of income spent on housing.',
    ],
  },
  household_price_level: {
    title: 'Household price levels', category: 'Household economy', frequency: 'A', valueUnit: 'EU27 = 100',
    scope: 'Household final consumption · Price level index · EU27 = 100',
    readingTitle: 'Prices relative to the EU',
    reading: [
      'The price level index compares household consumption prices with the EU27 reference, set to 100 in each year. EU27_2020 describes the membership of the reference group.',
      'It is not a time index with 2020 as a base year, an amount in euros, or a measure of personal purchasing power. A change also reflects movement relative to the EU reference.',
    ],
  },
  rent_price_index: {
    title: 'Actual rent price index', category: 'Housing', frequency: 'M', valueUnit: 'index',
    scope: 'HICP · Actual rentals for housing · ECOICOP version 2',
    readingTitle: 'A rent trend, not a listing',
    reading: [
      'This HICP component tracks changes in actual rentals for housing. It is an index with 2025 = 100, rather than an average monthly rent.',
      'It does not describe asking rents, a particular city, or the rent for a specific home. Coverage follows the official consumer-price methodology.',
    ],
  },
  mortgage_borrowing_rate: {
    title: 'Housing loan borrowing rate', category: 'Mortgage rates', frequency: 'M', valueUnit: '% per year',
    scope: 'ECB · House purchase loans · New business · Composite borrowing cost',
    readingTitle: 'A national borrowing indicator',
    reading: [
      'The ECB composite cost of borrowing for new household house-purchase loans uses the annualised agreed rate or narrowly defined effective rate for the selected official series.',
      'It is not a personalised bank offer or necessarily an annual percentage rate of charge. Fees, borrower characteristics and lending coverage can affect a real loan offer.',
    ],
  },
};

export interface Indicator {
  code: IndicatorCode;
  dataset_code: string;
  dataset_name?: string;
  name: string;
  description: string;
  unit: string;
  frequency: Frequency;
  dimensions: Record<string, string>;
  source_url: string;
  publisher: string;
  attribution: string;
  source_updated_at: string | null;
  retrieved_at: string | null;
  status_labels?: Record<string, string>;
  source_notes?: string;
  last_success_at?: string | null;
  latest_attempt?: IngestionAttempt | null;
  comparison_kind?: 'index' | 'percentage_points';
  value_kind?: string;
}

export interface Observation {
  country: CountryCode;
  indicator: IndicatorCode;
  period: string;
  value: number | null;
  status: string | null;
  dimensions?: Record<string, string>;
  source_url?: string;
  source_updated_at?: string | null;
  retrieved_at?: string | null;
}

export interface DataBundle {
  schema_version: 1;
  exported_at: string | null;
  countries: { code: CountryCode; name: string }[];
  indicators: Indicator[];
  observations: Observation[];
  pipeline: {
    status: 'not_synced' | 'success';
    last_success_at: string | null;
    latest_attempt?: IngestionAttempt | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

function validAttempt(value: unknown): boolean {
  return value === undefined || value === null || isRecord(value)
    && ['running', 'success', 'failed'].includes(String(value.status))
    && typeof value.started_at === 'string' && nullableString(value.finished_at) && nullableString(value.error);
}

function isIndicatorCode(value: unknown): value is IndicatorCode {
  return typeof value === 'string' && Object.hasOwn(indicatorDetails, value);
}

function validPeriod(period: unknown, frequency: Frequency): period is string {
  if (typeof period !== 'string') return false;
  if (frequency === 'A') return /^[1-9]\d{3}$/.test(period);
  if (frequency === 'Q') return /^[1-9]\d{3}-Q[1-4]$/.test(period);
  return /^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(period);
}

function validValue(indicator: IndicatorCode, value: unknown): boolean {
  if (value === null) return true;
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (indicator === 'hicp_annual_change' || indicator === 'mortgage_borrowing_rate') return value > -100;
  if (indicator === 'housing_cost_overburden') return value >= 0 && value <= 100;
  if (['annual_net_earnings', 'median_equivalised_income', 'household_consumption_expenditure'].includes(indicator)) return value >= 0;
  return value > 0;
}

export function parseBundle(value: unknown): DataBundle {
  const invalid = () => new Error('The data export has an unsupported or incomplete format. Regenerate it with python -m pipelines.export_static.');
  if (!isRecord(value) || value.schema_version !== 1 || !nullableString(value.exported_at)
    || !Array.isArray(value.countries) || !Array.isArray(value.indicators) || !Array.isArray(value.observations)
    || !isRecord(value.pipeline) || !['success', 'not_synced'].includes(String(value.pipeline.status))
    || !nullableString(value.pipeline.last_success_at)) throw invalid();

  const exportedCountries = value.countries;
  if (exportedCountries.length !== 3 || countries.some(country =>
    !exportedCountries.some((entry: unknown) => isRecord(entry) && entry.code === country.code && entry.name === country.name))) throw invalid();
  if (!validAttempt(value.pipeline.latest_attempt)) throw invalid();

  const indicators = new Map<string, Indicator>();
  for (const indicator of value.indicators) {
    if (!isRecord(indicator) || !isIndicatorCode(indicator.code) || indicator.frequency !== indicatorDetails[indicator.code].frequency
      || !isRecord(indicator.dimensions) || !Object.values(indicator.dimensions).every(item => typeof item === 'string')
      || !['dataset_code', 'name', 'description', 'unit', 'source_url', 'publisher', 'attribution'].every(key => typeof indicator[key] === 'string' && indicator[key] !== '')
      || !nullableString(indicator.source_updated_at) || !nullableString(indicator.retrieved_at)
      || indicator.status_labels !== undefined && (!isRecord(indicator.status_labels) || !Object.values(indicator.status_labels).every(item => typeof item === 'string'))
      || indicator.dataset_name !== undefined && typeof indicator.dataset_name !== 'string'
      || indicator.source_notes !== undefined && typeof indicator.source_notes !== 'string'
      || indicator.last_success_at !== undefined && !nullableString(indicator.last_success_at)
      || indicator.comparison_kind !== undefined && !['index', 'percentage_points'].includes(String(indicator.comparison_kind))
      || indicator.value_kind !== undefined && typeof indicator.value_kind !== 'string'
      || !validAttempt(indicator.latest_attempt)
      || indicators.has(indicator.code)) throw invalid();
    indicators.set(indicator.code, indicator as unknown as Indicator);
  }

  const keys = new Set<string>();
  for (const observation of value.observations) {
    if (!isRecord(observation) || !countries.some(country => country.code === observation.country)
      || !isIndicatorCode(observation.indicator) || !indicators.has(observation.indicator)
      || !validPeriod(observation.period, indicatorDetails[observation.indicator].frequency)
      || !validValue(observation.indicator, observation.value)
      || !nullableString(observation.status)
      || observation.source_url !== undefined && typeof observation.source_url !== 'string'
      || observation.source_updated_at !== undefined && !nullableString(observation.source_updated_at)
      || observation.retrieved_at !== undefined && !nullableString(observation.retrieved_at)
      || observation.dimensions !== undefined && (!isRecord(observation.dimensions) || !Object.values(observation.dimensions).every(item => typeof item === 'string'))) throw invalid();
    const key = `${observation.country}:${observation.indicator}:${observation.period}`;
    if (keys.has(key)) throw invalid();
    keys.add(key);
  }
  return value as unknown as DataBundle;
}

export async function loadData(signal?: AbortSignal): Promise<DataBundle> {
  const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '');
  const url = apiBase ? `${apiBase}/api/export` : `${import.meta.env.BASE_URL}data/observations.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
  } catch {
    throw new Error(`Could not reach the ${apiBase ? 'local API' : 'static data export'}. Check your connection and ${apiBase ? 'VITE_API_BASE_URL' : 'public/data/observations.json'}, then retry.`);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
  if (!response.ok) throw new Error(`The ${apiBase ? 'local API' : 'static data export'} returned HTTP ${response.status}. Check the server or run python -m pipelines.export_static, then retry.`);
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('The server did not return a JSON data export. Check the data file or API address, then retry.');
  }
  return parseBundle(data);
}

export function filterObservations(observations: Observation[], selected: CountryCode[], start: string, end: string, indicator: IndicatorCode): Observation[] {
  return observations.filter(row => row.indicator === indicator && selected.includes(row.country) && row.period >= start && row.period <= end)
    .sort((a, b) => a.period.localeCompare(b.period) || a.country.localeCompare(b.country));
}

export function toggleCountry(selected: CountryCode[], country: CountryCode): CountryCode[] {
  if (!selected.includes(country)) return countries.map(item => item.code).filter(code => selected.includes(code) || code === country);
  return selected.length > 2 ? selected.filter(code => code !== country) : selected;
}

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(observations: Observation[], indicator: Indicator): string {
  const rows: unknown[][] = [
    ['country', 'indicator', 'period', 'value', 'unit', 'frequency', 'status', 'dataset', 'publisher', 'source_url', 'source_updated_at', 'retrieved_at', 'dimensions'],
    ...observations.filter(row => row.indicator === indicator.code).map(row => [
      row.country, row.indicator, row.period, row.value,
      indicator.unit, indicator.frequency, row.status,
      indicator.dataset_code, indicator.publisher,
      row.source_url ?? indicator.source_url,
      row.source_updated_at !== undefined ? row.source_updated_at : indicator.source_updated_at,
      row.retrieved_at !== undefined ? row.retrieved_at : indicator.retrieved_at,
      JSON.stringify(row.dimensions ?? indicator.dimensions),
    ]),
  ];
  return rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function formatPeriod(period: string): string {
  if (/^\d{4}-\d{2}$/.test(period)) {
    return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${period}-01T00:00:00Z`));
  }
  return period.replace('-', ' ');
}

export function calendarPeriods(first: string, last: string, frequency: Frequency): string[] {
  if (!first || !last) return [];
  const perYear = frequency === 'A' ? 1 : frequency === 'Q' ? 4 : 12;
  const periodNumber = (period: string) => Number(period.slice(0, 4)) * perYear
    + (frequency === 'A' ? 0 : Number(frequency === 'Q' ? period.at(-1) : period.slice(5)) - 1);
  const start = periodNumber(first);
  const end = periodNumber(last);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => {
    const period = start + index;
    const year = Math.floor(period / perYear);
    if (frequency === 'A') return String(year);
    if (frequency === 'Q') return `${year}-Q${period % 4 + 1}`;
    return `${year}-${String(period % 12 + 1).padStart(2, '0')}`;
  });
}

export function unitLabel(indicator: Indicator): string {
  if (indicator.code === 'annual_net_earnings' || indicator.code === 'median_equivalised_income') return 'EUR / year';
  if (indicator.code === 'hicp_annual_change') return '% · same month of the previous year';
  if (indicator.code === 'housing_cost_overburden') return '% of population';
  if (indicator.code === 'household_price_level') return 'Price level index · EU27 = 100';
  if (indicator.code === 'household_consumption_expenditure') return 'Current prices · million EUR';
  if (indicator.code === 'household_consumption_volume') return 'Chain linked volume index · 2020 = 100';
  if (indicator.code === 'mortgage_borrowing_rate') return '% per year · AAR / NDER';
  if (indicator.dimensions.unit === 'I15_Q') return 'Index · 2015 = 100';
  if (indicator.dimensions.unit === 'I25') return 'Index · 2025 = 100';
  return indicator.unit;
}

export function frequencyLabel(frequency: Frequency): string {
  return { A: 'Annual', Q: 'Quarterly', M: 'Monthly' }[frequency];
}

export function statusLabel(status: string | null, indicator: Indicator): string {
  if (!status) return 'No flag';
  const labels = [...status].map(flag => indicator.status_labels?.[flag]).filter(Boolean);
  return labels.length ? `${status} · ${labels.join('; ')}` : status;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(date) + ' UTC';
}
