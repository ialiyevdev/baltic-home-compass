import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AnalyticsPage from './AnalyticsPage';
import { analyticsCsv, comparisonRankings, parseAnalyticsCatalogue, visibleComponents } from './analytics';
import type { AnalyticsCatalogue, AnalyticsPoint, AnalyticsSeries, Comparison, Ranking } from './analytics';
import type { Indicator } from './data';

vi.mock('./AnalyticsChart', () => ({ default: ({ series }: { series: AnalyticsSeries[] }) => <div data-testid="analytics-chart" data-components={[...new Set(series.map(item => item.component))].join(',')} /> }));

// These supplied analytical results are synthetic test fixtures, never public data.
const source: Indicator = {
  code: 'house_price_index', dataset_code: 'prc_hpi_q', name: 'Test house price index', description: 'Synthetic source metadata.',
  frequency: 'Q', unit: 'Quarterly index, 2015=100', dimensions: { freq: 'Q', unit: 'I15_Q', purchase: 'TOTAL' },
  publisher: 'Eurostat', source_url: 'https://ec.europa.eu/eurostat/', attribution: 'Source: Eurostat', source_updated_at: null, retrieved_at: null,
};
const point = (period: string, value: number | null, change: number | null, reason: string | null = null): AnalyticsPoint => ({ period, value, change, raw_value: value, flags: [], source_periods: [period], reason });
const countries = ['EE', 'LV', 'LT'] as const;
const rankingRows: Ranking[] = [
  { component: 'hpi', country: 'EE', rank: 1, change: 20, unit: '%', base_value: 100, end_value: 120 },
  { component: 'hpi', country: 'LV', rank: 2, change: 10, unit: '%', base_value: 100, end_value: 110 },
  { component: 'hpi', country: 'LT', rank: 2, change: 10, unit: '%', base_value: 100, end_value: 110 },
  { component: 'earnings', country: 'EE', rank: 1, change: 20, unit: '%', base_value: 100, end_value: 120 },
  { component: 'earnings', country: 'LV', rank: 1, change: 20, unit: '%', base_value: 100, end_value: 120 },
  { component: 'earnings', country: 'LT', rank: 2, change: 10, unit: '%', base_value: 100, end_value: 110 },
];
const comparison: Comparison = {
  metric: 'housing_earnings', indicator: null, status: 'available', title: 'Test house prices and earnings', frequency: 'A', unit: 'Index, selected base = 100',
  base_period: '2020', start_period: '2020', end_period: '2023', available_periods: ['2020', '2022', '2023', '2024', '2025'], countries: [...countries],
  series: countries.flatMap(country => ['hpi', 'earnings'].map(component => ({
    country, component, label: component === 'hpi' ? 'House price index' : 'Annual net earnings', unit: 'Index, selected base = 100', raw_unit: 'Test unit', change_unit: '%',
    points: [point('2020', 100, 0), point('2021', null, null, 'Missing source period.'), point('2022', 105, 5), point('2023', 110, 10), { ...point('2024', null, null, 'A source break separates this period from the selected base.'), flags: ['b'] }, point('2025', null, null, 'A source break separates this period from the selected base.')],
  }))),
  rankings: rankingRows, rankings_by_period: { '2020': [], '2022': rankingRows, '2023': rankingRows }, exclusions: [],
  method: 'Synthetic precomputed alignment method.', caveats: ['A source break in 2024 prevents comparisons across that boundary.'], sources: [source],
};
const laterComparison: Comparison = {
  ...comparison, base_period: '2024', start_period: '2024', end_period: '2025', available_periods: ['2024', '2025'],
  series: comparison.series.map(series => ({ ...series, points: [point('2024', 100, 0), point('2025', 110, 10)] })),
  rankings_by_period: { '2024': [], '2025': rankingRows },
};
const inflationComparison: Comparison = {
  ...laterComparison, metric: 'housing_inflation', title: 'Test nominal and adjusted housing',
  series: countries.flatMap(country => ['nominal_hpi', 'real_hpi', 'hicp'].map(component => ({ ...laterComparison.series[0], country, component, label: component, points: [point('2024', 100, 0), point('2025', 105, 5)] }))),
  rankings_by_period: { '2025': [] },
};
const catalogue: AnalyticsCatalogue = {
  schema_version: 1, exported_at: null, alignment: 'Common periods for all three countries', analyses: [
    { key: 'housing_earnings', metric: 'housing_earnings', indicator: null, title: comparison.title, frequency: 'A', unit: comparison.unit, default_base: '2024', available_bases: ['2020', '2024'], scenarios: [comparison, laterComparison] },
    { key: 'housing_inflation', metric: 'housing_inflation', indicator: null, title: inflationComparison.title, frequency: 'A', unit: comparison.unit, default_base: '2024', available_bases: ['2024'], scenarios: [inflationComparison] },
  ],
};

function respond(value = catalogue) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => value }));
}

describe('precomputed analytical data', () => {
  it('retains missing values, reasons and original flags', () => {
    const parsed = parseAnalyticsCatalogue(catalogue);
    expect(parsed.analyses[0].scenarios[0].series[0].points[1].value).toBeNull();
    expect(parsed.analyses[0].scenarios[0].series[0].points[4].flags).toEqual(['b']);
  });

  it('rejects non-finite analytical results', () => {
    const broken = structuredClone(catalogue);
    broken.analyses[0].scenarios[0].series[0].points[0].value = Number.NaN;
    expect(() => parseAnalyticsCatalogue(broken)).toThrow('incomplete or unsupported');
  });

  it('selects supplied nominal and real components without recalculation', () => {
    expect(visibleComponents(inflationComparison, 'nominal')).toEqual(['nominal_hpi', 'hicp']);
    expect(visibleComponents(inflationComparison, 'real')).toEqual(['real_hpi']);
    expect(visibleComponents({ ...inflationComparison, metric: 'real_earnings' }, 'real')).toEqual(['real_earnings']);
  });

  it('filters precalculated rankings by endpoint, country and component', () => {
    expect(comparisonRankings(comparison, '2023', ['EE', 'LV'], ['hpi'])).toEqual(rankingRows.slice(0, 2));
    expect(comparisonRankings(comparison, '2025', ['EE', 'LV'], ['hpi'])).toEqual([]);
  });

  it('exports only displayed components and periods, preserving unavailable values', () => {
    const csv = analyticsCsv(comparison, ['EE', 'LV'], ['hpi'], '2023');
    expect(csv.trim().split('\r\n')).toHaveLength(9);
    expect(csv).not.toContain(',LT,');
    expect(csv).not.toContain(',earnings,');
    expect(csv).not.toContain(',2024,');
    expect(csv).toContain('Missing source period.');
    expect(csv).toContain('2021,,');
  });
});

describe('analytical controls and explanations', () => {
  it('uses the latest compatible segment and offers only ranked endpoints for an earlier base', async () => {
    respond();
    render(<AnalyticsPage />);
    expect(await screen.findByRole('combobox', { name: 'Base period' })).toHaveValue('2024');
    expect(screen.getByRole('combobox', { name: 'Through' })).toHaveValue('2025');
    fireEvent.change(screen.getByRole('combobox', { name: 'Base period' }), { target: { value: '2020' } });
    const through = screen.getByRole('combobox', { name: 'Through' });
    expect(through).toHaveValue('2023');
    expect(within(through).getAllByRole('option').map(option => option.getAttribute('value'))).toEqual(['2022', '2023']);
    expect(screen.getByText(/including a country hidden from the chart/)).toBeVisible();
  });

  it('reports ties explicitly and retains country selection while changing views', async () => {
    respond();
    render(<AnalyticsPage />);
    await screen.findByRole('combobox', { name: 'Analysis' });
    expect(screen.getByText('Greatest change · tied')).toBeVisible();
    expect(screen.getByText('Estonia, Latvia')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Lithuania (LT)' }));
    expect(screen.getByText(/selected countries share the same change/)).toHaveTextContent('+20 %');
    fireEvent.change(screen.getByRole('combobox', { name: 'Analysis' }), { target: { value: 'housing_inflation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Inflation adjusted' }));
    expect(await screen.findByTestId('analytics-chart')).toHaveAttribute('data-components', 'real_hpi');
    expect(screen.getByRole('button', { name: 'Lithuania (LT)' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps missing aligned observations visible in the table', async () => {
    respond();
    render(<AnalyticsPage />);
    await screen.findByRole('combobox', { name: 'Base period' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Base period' }), { target: { value: '2020' } });
    fireEvent.click(screen.getByText('View the aligned data'));
    expect(within(screen.getByRole('table')).getAllByText('Missing source period.')).toHaveLength(6);
  });

  it('shows analytics failure and recovers on an explicit retry', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => catalogue }));
    render(<AnalyticsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
    fireEvent.click(screen.getByRole('button', { name: 'Retry analytics' }));
    expect(await screen.findByRole('combobox', { name: 'Analysis' })).toBeVisible();
  });
});
