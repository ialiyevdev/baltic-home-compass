import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import type { DataBundle } from './data';

vi.mock('./ComparisonChart', () => ({ default: () => <div data-testid="comparison-chart" /> }));
vi.mock('./CalculatorChart', () => ({ default: () => <div data-testid="calculator-chart" /> }));

const emptyBundle: DataBundle = {
  schema_version: 1, exported_at: null,
  countries: [{ code: 'EE', name: 'Estonia' }, { code: 'LV', name: 'Latvia' }, { code: 'LT', name: 'Lithuania' }],
  indicators: [], observations: [], pipeline: { status: 'not_synced', last_success_at: null },
};

// This small synthetic dataset exercises UI controls; it is excluded from production.
const populatedBundle: DataBundle = {
  ...emptyBundle,
  indicators: [{
    code: 'house_price_index', dataset_code: 'prc_hpi_q', name: 'Test house price index',
    description: 'Test metadata', unit: 'I15_Q', frequency: 'Q', dimensions: { unit: 'I15_Q', purchase: 'TOTAL' },
    source_url: 'https://ec.europa.eu/eurostat/', publisher: 'Eurostat', attribution: 'Source: Eurostat',
    source_updated_at: null, retrieved_at: null,
  }],
  observations: [
    { country: 'EE', indicator: 'house_price_index', period: '2024-Q1', value: 101, status: null },
    { country: 'LV', indicator: 'house_price_index', period: '2024-Q1', value: 102, status: null },
    { country: 'LT', indicator: 'house_price_index', period: '2024-Q1', value: 103, status: null },
    { country: 'EE', indicator: 'house_price_index', period: '2024-Q2', value: 104, status: null },
    { country: 'LV', indicator: 'house_price_index', period: '2024-Q2', value: 105, status: null },
    { country: 'LT', indicator: 'house_price_index', period: '2024-Q2', value: 106, status: null },
  ],
  pipeline: { status: 'success', last_success_at: null },
};

const earnings = {
  ...populatedBundle.indicators[0], code: 'annual_net_earnings' as const, dataset_code: 'earn_nt_net',
  name: 'Annual net earnings', unit: 'Euro', frequency: 'A' as const,
  dimensions: { freq: 'A', currency: 'EUR', estruct: 'NET', ecase: 'P1_NCH_AW100' },
  status_labels: { b: 'break in time series' },
  source_notes: 'Synthetic source note: a compiler change creates a break in 2024.',
};
const consumerIndex = {
  ...populatedBundle.indicators[0], code: 'hicp_index' as const, dataset_code: 'prc_hicp_minr',
  name: 'Consumer price index', unit: 'Index, 2025=100', frequency: 'M' as const,
  dimensions: { freq: 'M', unit: 'I25', coicop18: 'TOTAL' },
};
const annualInflation = {
  ...consumerIndex, code: 'hicp_annual_change' as const, name: 'Annual inflation', unit: 'Annual rate of change',
  dimensions: { freq: 'M', unit: 'RCH_A', coicop18: 'TOTAL' },
};
const multiBundle: DataBundle = {
  ...populatedBundle,
  indicators: [populatedBundle.indicators[0], earnings, consumerIndex, annualInflation],
  observations: [
    ...populatedBundle.observations,
    ...(['EE', 'LV', 'LT'] as const).flatMap(country => [
      { country, indicator: 'annual_net_earnings' as const, period: '2023', value: 16000, status: null },
      { country, indicator: 'annual_net_earnings' as const, period: '2024', value: 18000, status: 'b' },
      { country, indicator: 'hicp_index' as const, period: '2025-12', value: 101, status: null },
      { country, indicator: 'hicp_index' as const, period: '2026-01', value: 102, status: null },
      { country, indicator: 'hicp_annual_change' as const, period: '2025-12', value: -0.5, status: null },
      { country, indicator: 'hicp_annual_change' as const, period: '2026-01', value: 0, status: null },
    ]),
  ],
};

function respond(bundle: DataBundle) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => bundle }));
}

describe('data states', () => {
  it('keeps calculator assumptions across navigation even when statistical data fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Statistics unavailable')));
    render(<App />);
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Calculators' }));
    await screen.findByRole('heading', { name: 'Mortgage calculator' });
    expect(screen.queryByRole('heading', { name: 'The data could not be loaded.' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Purchase price (EUR)'), { target: { value: '160000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Compare Countries' }));
    expect(screen.getByRole('heading', { name: 'The data could not be loaded.' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Calculators' }));
    expect(screen.getByLabelText('Purchase price (EUR)')).toHaveValue(160000);
    expect(screen.getByLabelText('Mortgage results')).toBeVisible();
  });

  it('shows an honest empty state and keeps calculators available', async () => {
    respond(emptyBundle);
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'The comparison is ready for its first data sync.' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Calculators' })).toBeEnabled();
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Data & Methodology' }));
    expect(screen.getByRole('heading', { name: 'Awaiting the first successful sync.' })).toBeVisible();
  });

  it('loads analytics only when that section is opened', async () => {
    respond(populatedBundle);
    render(<App />);
    await screen.findByRole('heading', { name: 'House price index' });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Analytics' })).toBeVisible();
    expect(screen.queryByRole('combobox', { name: 'Analysis' })).not.toBeInTheDocument();
  });

  it('reports API errors and retries loading data', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, json: async () => emptyBundle });
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('HTTP 503');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'The comparison is ready for its first data sync.' })).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports a failed latest refresh alongside the usable last successful snapshot', async () => {
    respond({ ...populatedBundle, pipeline: { status: 'success', last_success_at: null, latest_attempt: { status: 'failed', started_at: '2026-01-01T00:00:00Z', finished_at: '2026-01-01T00:00:01Z', error: 'Upstream timeout' } } });
    render(<App />);
    await screen.findByRole('heading', { name: 'House price index' });
    fireEvent.click(screen.getByRole('button', { name: 'Data & Methodology' }));
    expect(screen.getByRole('status')).toHaveTextContent('The latest refresh failed.');
    expect(screen.getByRole('status')).toHaveTextContent('Upstream timeout');
  });
});

describe('comparison controls', () => {
  it('updates displayed observations with country and date selections', async () => {
    respond(populatedBundle);
    render(<App />);
    await screen.findByRole('heading', { name: 'House price index' });
    fireEvent.click(screen.getByRole('button', { name: 'Lithuania (LT)' }));
    expect(screen.getByRole('button', { name: 'Lithuania (LT)' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'Latvia (LV)' }));
    expect(screen.getByRole('button', { name: 'Latvia (LV)' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-Q2' } });
    fireEvent.click(screen.getByText('View the displayed data'));
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).queryByText('Lithuania')).not.toBeInTheDocument();
    expect(within(table).queryByText('2024 Q1')).not.toBeInTheDocument();
    expect(within(table).getByText('104')).toBeVisible();
    expect(within(table).getByText('105')).toBeVisible();
  });

  it('switches frequencies, resets dates and keeps the country selection', async () => {
    respond(multiBundle);
    render(<App />);
    await screen.findByRole('heading', { name: 'House price index' });
    fireEvent.click(screen.getByRole('button', { name: 'Lithuania (LT)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '2024-Q2' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Indicator' }), { target: { value: 'annual_net_earnings' } });
    expect(screen.getByRole('heading', { name: 'Annual net earnings' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('2023');
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('2024');
    expect(screen.getByRole('button', { name: 'Lithuania (LT)' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Synthetic source note: a compiler change creates a break in 2024.')).toBeVisible();
    expect(screen.getByRole('region', { name: 'Latest available value in the selected period' })).toHaveTextContent('EUR / year');
    expect(screen.getByRole('region', { name: 'Latest available value in the selected period' })).toHaveTextContent('break in time series');

    fireEvent.change(screen.getByRole('combobox', { name: 'Indicator' }), { target: { value: 'hicp_index' } });
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('2025-12');
    fireEvent.change(screen.getByRole('combobox', { name: 'From' }), { target: { value: '2026-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Indicator' }), { target: { value: 'hicp_annual_change' } });
    expect(screen.getByRole('heading', { name: 'Annual inflation' })).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'From' })).toHaveValue('2025-12');
    expect(screen.getByRole('combobox', { name: 'To' })).toHaveValue('2026-01');
    expect(screen.getByRole('region', { name: 'Latest available value in the selected period' })).toHaveTextContent('% year-on-year');
  });

  it('shows metadata and completeness for the chosen indicator only', async () => {
    respond(multiBundle);
    render(<App />);
    await screen.findByRole('heading', { name: 'House price index' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Indicator' }), { target: { value: 'annual_net_earnings' } });
    fireEvent.click(screen.getByRole('button', { name: 'Data & Methodology' }));
    expect(screen.getByRole('heading', { name: 'Annual net earnings' })).toBeVisible();
    expect(screen.getByText('earn_nt_net ↗')).toBeVisible();
    expect(screen.getByText('ecase=P1_NCH_AW100')).toBeVisible();
    expect(screen.getAllByText('2 values')).toHaveLength(3);
    expect(screen.queryByText('prc_hpi_q ↗')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Indicator' }), { target: { value: 'hicp_annual_change' } });
    expect(screen.getByRole('heading', { name: 'Annual inflation' })).toBeVisible();
    expect(screen.getByText('unit=RCH_A')).toBeVisible();
    expect(screen.getByText('Jan 2026')).toBeVisible();
  });

  it('shows unavailable source data without substituting another indicator', async () => {
    respond({ ...multiBundle, observations: populatedBundle.observations });
    render(<App />);
    await screen.findByRole('heading', { name: 'House price index' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Indicator' }), { target: { value: 'annual_net_earnings' } });
    expect(screen.getByRole('heading', { name: 'Annual net earnings is not available in this snapshot.' })).toBeVisible();
    expect(screen.queryByTestId('comparison-chart')).not.toBeInTheDocument();
  });
});
