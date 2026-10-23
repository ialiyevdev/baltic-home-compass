import type { CountryCode, Frequency, Indicator, IndicatorCode } from './data';

export type AnalyticsMetric = 'housing_earnings' | 'housing_inflation' | 'real_earnings' | 'indicator_change';

export interface AnalyticsPoint {
  period: string;
  value: number | null;
  raw_value: number | null;
  change: number | null;
  flags: string[];
  source_periods: string[];
  reason: string | null;
}

export interface AnalyticsSeries {
  country: CountryCode;
  component: string;
  label: string;
  unit: string;
  raw_unit: string;
  change_unit: string;
  points: AnalyticsPoint[];
}

export interface Ranking {
  component: string;
  country: CountryCode;
  rank: number;
  change: number;
  unit: string;
  base_value: number;
  end_value: number;
}

export interface Comparison {
  metric: AnalyticsMetric;
  indicator: IndicatorCode | null;
  status: 'available' | 'unavailable';
  title: string;
  frequency: Frequency;
  unit: string;
  base_period: string | null;
  start_period: string | null;
  end_period: string | null;
  available_periods: string[];
  countries: CountryCode[];
  series: AnalyticsSeries[];
  rankings: Ranking[];
  rankings_by_period: Record<string, Ranking[]>;
  exclusions: { country: CountryCode; component: string; period: string; reason: string }[];
  method: string;
  caveats: string[];
  sources: Indicator[];
  methodology_sources?: { title: string; url: string }[];
}

export interface Analysis {
  key: string;
  metric: AnalyticsMetric;
  indicator: IndicatorCode | null;
  title: string;
  frequency: Frequency;
  unit: string;
  default_base: string | null;
  available_bases: string[];
  scenarios: Comparison[];
}

export interface AnalyticsCatalogue {
  schema_version: 1;
  exported_at: string | null;
  alignment: string;
  analyses: Analysis[];
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string');
}

function nullableNumber(value: unknown): boolean {
  return value === null || typeof value === 'number' && Number.isFinite(value);
}

function validRanking(value: unknown): boolean {
  return record(value) && ['EE', 'LV', 'LT'].includes(String(value.country)) && typeof value.component === 'string'
    && typeof value.rank === 'number' && Number.isInteger(value.rank) && value.rank >= 1
    && ['change', 'base_value', 'end_value'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
    && typeof value.unit === 'string';
}

export function parseAnalyticsCatalogue(value: unknown): AnalyticsCatalogue {
  const invalid = () => new Error('The analytics export is incomplete or unsupported. Run python -m pipelines.export_static and rebuild the frontend.');
  if (!record(value) || value.schema_version !== 1 || !(value.exported_at === null || typeof value.exported_at === 'string')
    || typeof value.alignment !== 'string' || !Array.isArray(value.analyses)) throw invalid();
  const keys = new Set<string>();
  for (const analysis of value.analyses) {
    if (!record(analysis) || typeof analysis.key !== 'string' || keys.has(analysis.key)
      || !['housing_earnings', 'housing_inflation', 'real_earnings', 'indicator_change'].includes(String(analysis.metric))
      || !(analysis.indicator === null || typeof analysis.indicator === 'string')
      || typeof analysis.title !== 'string' || typeof analysis.unit !== 'string'
      || !['A', 'Q', 'M'].includes(String(analysis.frequency)) || !strings(analysis.available_bases)
      || !(analysis.default_base === null || typeof analysis.default_base === 'string') || !Array.isArray(analysis.scenarios)) throw invalid();
    keys.add(analysis.key);
    const bases = new Set<string | null>();
    for (const scenario of analysis.scenarios) {
      if (!record(scenario) || scenario.metric !== analysis.metric || scenario.indicator !== analysis.indicator
        || !['available', 'unavailable'].includes(String(scenario.status)) || typeof scenario.title !== 'string'
        || scenario.frequency !== analysis.frequency || typeof scenario.unit !== 'string'
        || !(scenario.base_period === null || typeof scenario.base_period === 'string') || bases.has(scenario.base_period)
        || !['start_period', 'end_period'].every(key => scenario[key] === null || typeof scenario[key] === 'string')
        || !strings(scenario.available_periods) || !strings(scenario.countries)
        || !scenario.countries.every(country => ['EE', 'LV', 'LT'].includes(country))
        || !Array.isArray(scenario.series) || !Array.isArray(scenario.rankings) || !scenario.rankings.every(validRanking)
        || !record(scenario.rankings_by_period) || !Object.values(scenario.rankings_by_period).every(rows => Array.isArray(rows) && rows.every(validRanking))
        || typeof scenario.method !== 'string' || !strings(scenario.caveats) || !Array.isArray(scenario.sources)
        || !Array.isArray(scenario.exclusions)) throw invalid();
      bases.add(scenario.base_period);
      for (const series of scenario.series) {
        if (!record(series) || !['EE', 'LV', 'LT'].includes(String(series.country))
          || !['component', 'label', 'unit', 'raw_unit', 'change_unit'].every(key => typeof series[key] === 'string')
          || !Array.isArray(series.points)) throw invalid();
        const periods = new Set<string>();
        for (const point of series.points) {
          if (!record(point) || typeof point.period !== 'string' || periods.has(point.period)
            || !nullableNumber(point.value) || !nullableNumber(point.raw_value) || !nullableNumber(point.change)
            || !strings(point.flags) || !strings(point.source_periods) || !(point.reason === null || typeof point.reason === 'string')) throw invalid();
          periods.add(point.period);
        }
      }
      if (!scenario.sources.every(source => record(source) && typeof source.code === 'string'
        && ['name', 'unit', 'frequency', 'source_url', 'publisher', 'attribution', 'dataset_code'].every(key => typeof source[key] === 'string'))) throw invalid();
    }
  }
  return value as unknown as AnalyticsCatalogue;
}

export async function loadAnalytics(signal?: AbortSignal): Promise<AnalyticsCatalogue> {
  const apiBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '');
  const url = apiBase ? `${apiBase}/api/analytics/catalogue` : `${import.meta.env.BASE_URL}data/analytics.json`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 20_000);
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  try {
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    } catch {
      throw new Error(`Analytics could not be reached. Check ${apiBase ? 'the local API and VITE_API_BASE_URL' : 'the static data/analytics.json export'}, then retry.`);
    }
    if (!response.ok) throw new Error(`Analytics returned HTTP ${response.status}. Run the local API or regenerate the static export, then retry.`);
    let value: unknown;
    try {
      value = await response.json();
    } catch {
      throw new Error('The analytics source did not return JSON. Check the configured API address or static export.');
    }
    return parseAnalyticsCatalogue(value);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function visibleComponents(comparison: Comparison, view: 'nominal' | 'real'): string[] {
  if (comparison.metric === 'housing_inflation') return view === 'real' ? ['real_hpi'] : ['nominal_hpi', 'hicp'];
  if (comparison.metric === 'real_earnings') return view === 'real' ? ['real_earnings'] : ['nominal_earnings', 'hicp'];
  return [...new Set(comparison.series.map(series => series.component))];
}

export function comparisonRankings(comparison: Comparison, end: string, selected: CountryCode[], components: string[]): Ranking[] {
  return (comparison.rankings_by_period[end] ?? []).filter(row => selected.includes(row.country) && components.includes(row.component));
}

export function analyticsCsv(comparison: Comparison, selected: CountryCode[], components: string[], end: string): string {
  const cell = (value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const rows: unknown[][] = [['metric', 'indicator', 'base_period', 'country', 'component', 'period', 'value', 'unit', 'change', 'change_unit', 'aligned_value', 'aligned_unit', 'flags', 'source_periods', 'reason', 'source_urls']];
  for (const series of comparison.series.filter(row => selected.includes(row.country) && components.includes(row.component))) {
    for (const point of series.points.filter(row => row.period >= (comparison.base_period ?? '') && row.period <= end)) {
      rows.push([
        comparison.metric, comparison.indicator, comparison.base_period, series.country, series.component, point.period,
        point.value, series.unit, point.change, series.change_unit, point.raw_value, series.raw_unit,
        point.flags.join(' '), point.source_periods.join(' '), point.reason, comparison.sources.map(source => source.source_url).join(' '),
      ]);
    }
  }
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
