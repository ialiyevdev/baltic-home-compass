import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { MouseEvent } from 'react';
import {
  calendarPeriods, countries, filterObservations, formatDate, formatPeriod, formatTimestamp,
  frequencyLabel, indicatorDetails, loadData, statusLabel, toCsv, unitLabel,
} from './data';
import type { CountryCode, DataBundle, Indicator, IndicatorCode, IngestionAttempt, Observation } from './data';
import CountrySelector, { CountrySymbol } from './CountrySelector';

type Page = 'compare' | 'analytics' | 'methodology' | 'calculators';
type LoadState = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: DataBundle };

const pages: Page[] = ['compare', 'analytics', 'methodology', 'calculators'];
const calculatorSections = ['mortgage-calculator', 'household-calculator', 'purchase-budget', 'rate-scenarios', 'amortization'];

function locationRoute(): { page: Page; section?: string } | null {
  const [page, section] = window.location.hash.slice(1).split('/');
  if (!pages.includes(page as Page)) return null;
  return { page: page as Page, section: page === 'calculators' && calculatorSections.includes(section) ? section : undefined };
}

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const ComparisonChart = lazy(() => import('./ComparisonChart'));
const Analytics = lazy(() => import('./AnalyticsPage'));
const Calculators = lazy(() => import('./CalculatorsPage'));

function Compass() {
  return <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" className="compass-mark">
    <circle cx="20" cy="20" r="18.5" stroke="currentColor" />
    <path d="m25.8 11-3 11.8L11 29l6.2-11.8L25.8 11Z" fill="currentColor" />
    <path d="m25.8 11-8.6 6.2 5.6 5.6 3-11.8Z" fill="#f7f8f5" stroke="currentColor" />
    <path d="M20 2v4M34 20h4M20 34v4M2 20h4" stroke="currentColor" />
  </svg>;
}

function DownloadIcon() {
  return <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

function IndicatorSelector({ indicators, selected, onChange }: {
  indicators: Indicator[];
  selected: Indicator | undefined;
  onChange: (code: IndicatorCode) => void;
}) {
  if (!selected) return null;
  return <section className="indicator-selector" aria-label="Indicator selection">
    <label>Indicator<select value={selected.code} onChange={event => onChange(event.target.value as IndicatorCode)}>
      {(['Housing', 'Household economy', 'Mortgage rates'] as const).map(category => {
        const available = Object.entries(indicatorDetails).filter(([code, details]) => details.category === category && indicators.some(indicator => indicator.code === code));
        return available.length > 0 && <optgroup key={category} label={category}>{available.map(([code, details]) => <option key={code} value={code}>{details.title}</option>)}</optgroup>;
      })}
    </select></label>
    <p>One series at a time, with its original frequency and definition.<br />{frequencyLabel(selected.frequency)} observations · {unitLabel(selected)}</p>
  </section>;
}

function RefreshWarning({ attempt }: { attempt: IngestionAttempt | null | undefined }) {
  if (!attempt || attempt.status !== 'failed') return null;
  return <div className="refresh-warning" role="status"><strong>The latest refresh failed.</strong><p>The last successful snapshot remains available. Attempt: {formatTimestamp(attempt.finished_at ?? attempt.started_at)}.</p>{attempt.error && <p>{attempt.error}</p>}</div>;
}

function EmptyState({ retry }: { retry: () => void }) {
  return <section className="state-panel" aria-labelledby="empty-title">
    <span className="eyebrow">AWAITING OFFICIAL DATA</span>
    <h2 id="empty-title">The comparison is ready for its first data sync.</h2>
    <p>No observations have been published to this build. Run the ingestion and static export commands in the project README, then reload the data.</p>
    <button className="button button-primary" onClick={retry}>Reload data</button>
  </section>;
}

function DataTable({ observations, indicator }: { observations: Observation[]; indicator: Indicator }) {
  return <details className="data-details">
    <summary>View the displayed data <span aria-hidden="true">↗</span></summary>
    <div className="table-scroll" tabIndex={0} role="region" aria-label={`Displayed ${indicatorDetails[indicator.code].title.toLowerCase()} observations`}>
      <table>
        <caption>{indicatorDetails[indicator.code].title} · {unitLabel(indicator)}. Missing observations are shown as unavailable. Original source flags are retained.</caption>
        <thead><tr><th scope="col">Period</th><th scope="col">Country</th><th scope="col">Value</th><th scope="col">Source status</th></tr></thead>
        <tbody>{observations.map(row => <tr key={`${row.country}-${row.period}`}>
          <th scope="row">{formatPeriod(row.period)}</th>
          <td>{countries.find(country => country.code === row.country)?.name}</td>
          <td>{row.value === null ? 'Unavailable' : numberFormat.format(row.value)}</td>
          <td>{statusLabel(row.status, indicator)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </details>;
}

function Compare({ data, indicator, retry, showMethodology }: { data: DataBundle; indicator: Indicator | undefined; retry: () => void; showMethodology: () => void }) {
  const observations = useMemo(() => data.observations.filter(row => row.indicator === indicator?.code), [data, indicator]);
  const periods = useMemo(() => {
    const available = observations.map(row => row.period).sort();
    return indicator ? calendarPeriods(available[0] ?? '', available.at(-1) ?? '', indicator.frequency) : [];
  }, [observations, indicator]);
  const [selected, setSelected] = useState<CountryCode[]>(['EE', 'LV', 'LT']);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  useEffect(() => {
    setStart('');
    setEnd('');
  }, [indicator?.code]);
  const firstPeriod = periods[0] ?? '';
  const lastPeriod = periods.at(-1) ?? '';
  const rangeStart = periods.includes(start) ? start : firstPeriod;
  const rangeEnd = periods.includes(end) ? end : lastPeriod;
  const displayed = indicator ? filterObservations(observations, selected, rangeStart, rangeEnd, indicator.code) : [];
  const chartData = periods.filter(period => period >= rangeStart && period <= rangeEnd).map(period => {
    const row: Record<string, string | number | null> = { period };
    for (const code of selected) {
      const observation = displayed.find(item => item.country === code && item.period === period);
      row[code] = observation?.value ?? null;
      row[`${code}_status`] = observation?.status ?? null;
    }
    return row;
  });
  const hasValues = displayed.some(row => row.value !== null);

  function downloadCsv() {
    if (!indicator) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', toCsv(displayed, indicator)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `baltic-${indicator.code}_${rangeStart}_${rangeEnd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!indicator || data.observations.length === 0) return <EmptyState retry={retry} />;
  if (observations.length === 0) return <section className="state-panel" role="status"><span className="eyebrow">NO EXPORTED OBSERVATIONS</span><h2>{indicatorDetails[indicator.code].title} is not available in this snapshot.</h2><p>Check this source in Data & Methodology and run another sync and export. Other indicators can still be selected above.</p><button className="button button-primary" onClick={retry}>Reload data</button></section>;
  const details = indicatorDetails[indicator.code];

  return <>
    <section className="comparison-controls" aria-label="Comparison settings">
      <CountrySelector selected={selected} onChange={setSelected} />
      <div className="date-controls">
        <label>From<select value={rangeStart} onChange={event => setStart(event.target.value)}>
          {periods.filter(period => period <= rangeEnd).map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
        </select></label>
        <span aria-hidden="true" className="date-dash">—</span>
        <label>To<select value={rangeEnd} onChange={event => setEnd(event.target.value)}>
          {periods.filter(period => period >= rangeStart).map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}
        </select></label>
      </div>
    </section>

    <section className={`latest-grid ${['annual_net_earnings', 'median_equivalised_income', 'household_consumption_expenditure'].includes(indicator.code) ? 'is-earnings' : ''}`} aria-label="Latest available value in the selected period">
      {countries.filter(country => selected.includes(country.code)).map(country => {
        const latest = displayed.filter(row => row.country === country.code && row.value !== null).at(-1);
        return <article className="latest-country" key={country.code} style={{ borderTopColor: country.color }}>
          <div className="latest-country-label"><span>{country.name}</span><span className="country-code">{country.code}</span></div>
          <div className="latest-value">{latest ? numberFormat.format(latest.value!) : '—'}<span>{latest ? details.valueUnit : 'No value'}</span></div>
          <p>{latest ? `${formatPeriod(latest.period)} · ${unitLabel(indicator)}` : 'No published value in this period'}</p>
          {latest?.status && <p className="observation-flag">Source status: {statusLabel(latest.status, indicator)}</p>}
        </article>;
      })}
    </section>

    <section className="chart-panel" aria-labelledby="chart-title">
      <div className="chart-toolbar">
        <div><span className="eyebrow">{frequencyLabel(indicator.frequency).toUpperCase()} OBSERVATIONS</span><h2 id="chart-title">{details.title}</h2><p>{unitLabel(indicator)} <span aria-hidden="true">/</span> {details.scope}</p></div>
        <button className="button button-outline" onClick={downloadCsv} disabled={displayed.length === 0}><DownloadIcon />Export CSV</button>
      </div>
      <div className="chart-layout">
        <div className="chart-area">
          <p id="chart-description" className="sr-only">{frequencyLabel(indicator.frequency)} {details.title.toLowerCase()} for {countries.filter(country => selected.includes(country.code)).map(country => country.name).join(', ')}, from {formatPeriod(rangeStart)} to {formatPeriod(rangeEnd)}. {unitLabel(indicator)}. Lines stop at missing observations and source flags marking breaks in series. A data table follows the chart.</p>
          {hasValues ? <div className="chart-canvas" role="region" aria-label={`${details.title} chart`} aria-describedby="chart-description">
            <Suspense fallback={<div className="chart-empty" role="status">Loading chart…</div>}><ComparisonChart data={chartData} selected={selected} indicator={indicator} /></Suspense>
          </div> : <div className="chart-empty" role="status">No published values are available for the selected countries and period.</div>}
          <div className="chart-legend" aria-label="Chart legend">{countries.filter(country => selected.includes(country.code)).map(country => <span key={country.code}><svg className="country-symbol" viewBox="0 0 16 16" aria-hidden="true"><CountrySymbol country={country.code} cx={8} cy={8} /></svg>{country.name}</span>)}</div>
          <p className="chart-help">Use the left and right arrow keys on the chart to inspect periods, or open the data table below. Country symbols also distinguish the lines.</p>
        </div>
        <aside className="chart-note">
          <span className="note-number">01 / READING THE DATA</span>
          <h3>{details.readingTitle}</h3>
          {details.reading.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
          <button className="text-link" onClick={showMethodology}>Sources & methodology <span aria-hidden="true">↗</span></button>
        </aside>
      </div>
      {indicator.source_notes && <div className={`source-note ${indicator.code === 'annual_net_earnings' ? 'has-break-note' : ''}`}><strong>Source context</strong><p>{indicator.source_notes}</p></div>}
      <RefreshWarning attempt={indicator.latest_attempt} />
      <div className="chart-source"><span>Source: <a href={indicator.source_url} target="_blank" rel="noreferrer">{indicator.publisher} · {indicator.dataset_code} ↗</a></span><span>Original unit: <code>{indicator.unit}</code> · Retrieved {formatDate(indicator.retrieved_at)}</span></div>
      <DataTable observations={displayed} indicator={indicator} />
    </section>

    <section className="scope-note"><span className="scope-icon" aria-hidden="true">i</span><div><h3>Different series, different definitions</h3><p>This view shows each published series at its original frequency. Income, aggregate consumption, price indices and borrowing rates describe different concepts. Calculators use your own assumptions, separately from these official observations.</p></div></section>
  </>;
}

function Methodology({ data, indicator }: { data: DataBundle; indicator: Indicator | undefined }) {
  const observations = data.observations.filter(row => row.indicator === indicator?.code);
  const latest = observations.filter(row => row.value !== null).map(row => row.period).sort().at(-1);
  const available = observations.filter(row => row.value !== null).length;
  const missing = observations.length - available;
  return <div className="methodology-page">
    <section className="pipeline-panel" aria-labelledby="pipeline-title">
      <div><span className="eyebrow">DATA PIPELINE</span><h2 id="pipeline-title">{data.pipeline.status === 'success' ? 'A verified snapshot, ready to explore.' : 'Awaiting the first successful sync.'}</h2><p>Eurostat and ECB APIs → validation → PostgreSQL → static data export</p></div>
      <span className={`status-pill ${data.pipeline.status === 'success' ? 'is-ready' : ''}`}><span />{data.pipeline.status === 'success' ? 'Snapshot available' : 'Not synced'}</span>
    </section>
    <RefreshWarning attempt={indicator?.latest_attempt !== undefined ? indicator.latest_attempt : data.pipeline.latest_attempt} />
    <div className="methodology-grid">
      <section className="method-card"><span className="eyebrow">01 / SOURCE & DEFINITION</span><h2>{indicator ? indicatorDetails[indicator.code].title : 'Indicator metadata'}</h2>
        {indicator ? <><p>{indicator.description}</p><dl className="metadata-list">
          <div><dt>Publisher</dt><dd>{indicator.publisher}</dd></div>
          <div><dt>Dataset</dt><dd><a href={indicator.source_url} target="_blank" rel="noreferrer">{indicator.dataset_code} ↗</a></dd></div>
          {indicator.dataset_name && <div><dt>Official dataset name</dt><dd>{indicator.dataset_name}</dd></div>}
          <div><dt>Unit</dt><dd>{unitLabel(indicator)} <code>({indicator.unit})</code></dd></div>
          <div><dt>Frequency</dt><dd>{frequencyLabel(indicator.frequency)} ({indicator.frequency})</dd></div>
          <div><dt>Geographic scope</dt><dd>Estonia, Latvia, Lithuania</dd></div>
          <div><dt>Source updated</dt><dd>{formatDate(indicator.source_updated_at)}</dd></div>
          <div><dt>Retrieved</dt><dd>{formatTimestamp(indicator.retrieved_at)}</dd></div>
          <div><dt>Latest observation</dt><dd>{latest ? formatPeriod(latest) : 'Not available'}</dd></div>
        </dl><h3>Selected API dimensions</h3><div className="dimension-list">{Object.entries(indicator.dimensions).map(([key, value]) => <code key={key}>{key}={value}</code>)}</div>{indicator.source_notes && <><h3>Source notes</h3><p>{indicator.source_notes}</p></>}{indicator.status_labels && Object.keys(indicator.status_labels).length > 0 && <><h3>Source flags</h3><div className="source-flags">{Object.entries(indicator.status_labels).map(([flag, label]) => <p key={flag}><code>{flag}</code> {label}</p>)}</div></>}<p className="attribution">{indicator.attribution}</p></> : <p>No indicator metadata has been exported yet.</p>}
      </section>
      <div className="method-side">
        <section className="method-card"><span className="eyebrow">02 / COMPLETENESS</span><h2>What is available</h2><dl className="metadata-list">
          <div><dt>Published values</dt><dd>{available}</dd></div><div><dt>Missing observations</dt><dd>{missing}</dd></div>
          <div><dt>Indicator sync</dt><dd>{formatTimestamp(indicator?.last_success_at !== undefined ? indicator.last_success_at : data.pipeline.last_success_at)}</dd></div><div><dt>Export based on sync</dt><dd>{formatTimestamp(data.exported_at)}</dd></div>
          {indicator?.latest_attempt && <div><dt>Latest indicator attempt</dt><dd>{indicator.latest_attempt.status} · {formatTimestamp(indicator.latest_attempt.finished_at ?? indicator.latest_attempt.started_at)}</dd></div>}
        </dl><div className="country-coverage">{countries.map(country => <p key={country.code}><span>{country.name}</span><strong>{observations.filter(row => row.country === country.code && row.value !== null).length} values</strong></p>)}</div><p className="small-copy">Counts describe the selected indicator in this export. They do not imply that the full historical series is included.</p></section>
        <section className="method-card limitations"><span className="eyebrow">03 / INTERPRETATION</span><h2>Keep the context</h2><ul>
          {indicatorDetails[indicator?.code ?? 'house_price_index'].reading.map(paragraph => <li key={paragraph}>{paragraph}</li>)}
          <li>Missing values remain missing. Lines stop at missing periods and source flags marking a break in series. Flags are retained in chart tooltips, the table and CSV.</li>
          <li>Compare Countries shows published values without rebasing or interpolation. Analytics labels its aligned and rebased calculations separately. No causal explanation is inferred.</li>
          <li>This static snapshot reflects its retrieval date. Revisions and newer publications require another data sync and export.</li>
          <li>Derived comparisons are calculations by Baltic Home Compass. Eurostat and the ECB are not responsible for these calculations or their interpretation.</li>
        </ul></section>
      </div>
    </div>
  </div>;
}

export default function App() {
  const [route, setRoute] = useState(() => locationRoute() ?? { page: 'compare' as Page });
  const page = route.page;
  const [calculatorsOpened, setCalculatorsOpened] = useState(page === 'calculators');
  const [navigationVersion, setNavigationVersion] = useState(0);
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [indicatorCode, setIndicatorCode] = useState<IndicatorCode>('house_price_index');
  const indicator = state.status === 'ready' ? state.data.indicators.find(item => item.code === indicatorCode) ?? state.data.indicators[0] : undefined;

  function changeIndicator(code: IndicatorCode) {
    setIndicatorCode(code);
  }

  function applyLocation() {
    const next = locationRoute();
    if (!next) return;
    setRoute(next);
    if (next.page === 'calculators') setCalculatorsOpened(true);
    setNavigationVersion(value => value + 1);
  }

  function navigate(nextPage: Page, event?: MouseEvent<HTMLAnchorElement>) {
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    event?.preventDefault();
    if (window.location.hash !== `#${nextPage}`) window.history.pushState(null, '', `#${nextPage}`);
    applyLocation();
  }

  useEffect(() => {
    window.addEventListener('hashchange', applyLocation);
    window.addEventListener('popstate', applyLocation);
    return () => {
      window.removeEventListener('hashchange', applyLocation);
      window.removeEventListener('popstate', applyLocation);
    };
  }, []);

  useEffect(() => {
    if (!navigationVersion || route.section) return;
    document.getElementById('page-title')?.focus();
  }, [navigationVersion, route.section]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadData(controller.signal).then(data => setState({ status: 'ready', data })).catch((error: unknown) => {
      if (controller.signal.aborted) return;
      setState({ status: 'error', message: error instanceof Error ? error.message : 'Data could not be loaded. Check your connection and the configured data source.' });
    });
    return () => controller.abort();
  }, [attempt]);

  const retry = () => setAttempt(value => value + 1);

  return <>
    <a href="#main" className="skip-link">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <a className="brand" href="#compare" onClick={event => navigate('compare', event)}><Compass /><span>Baltic Home Compass<span className="brand-subtitle">HOUSING · ECONOMY · EVERYDAY LIFE</span></span></a>
      <span className="header-region"><span className="region-line" />Estonia / Latvia / Lithuania</span>
    </div></header>
    <div className="navigation-wrap"><nav className="main-navigation" aria-label="Main navigation">
      {pages.map(item => <a key={item} href={`#${item}`} className={page === item ? 'active' : ''} onClick={event => navigate(item, event)} aria-current={page === item ? 'page' : undefined}>{item === 'compare' ? 'Compare Countries' : item === 'analytics' ? 'Analytics' : item === 'methodology' ? 'Data & Methodology' : 'Calculators'}</a>)}
    </nav></div>
    <main id="main" className="page-container" tabIndex={-1}>
      <section className="page-intro">
        <div><span className="eyebrow">{page === 'compare' ? 'THE BALTIC PICTURE' : page === 'analytics' ? 'CHANGES IN CONTEXT' : page === 'calculators' ? 'YOUR INPUTS. CLEAR ASSUMPTIONS.' : 'BEHIND THE NUMBERS'}</span><h1 id="page-title" tabIndex={-1}>{page === 'compare' ? <>Housing, earnings<br className="mobile-break" /> and prices.</> : page === 'analytics' ? 'Comparisons on common ground.' : page === 'calculators' ? 'Explore a home purchase.' : 'Clear sources. Useful context.'}</h1><p>{page === 'compare' ? 'Explore official statistics for Estonia, Latvia and Lithuania. Each series keeps its own dates, units and definition.' : page === 'analytics' ? 'Compare changes over the same periods, with explicit alignment, source definitions and inflation adjustments.' : page === 'calculators' ? 'See how your price, deposit, rate and household budget shape a mortgage scenario.' : 'Where the data comes from, how it is handled, and what it can tell us.'}</p></div>
        <div className="intro-caption"><span className="caption-rule" /><span>{page === 'calculators' ? <>Personal assumptions.<br />Transparent calculations.</> : <>Official statistics.<br />A shared frame of reference.</>}</span></div>
      </section>
      {page !== 'calculators' && state.status === 'ready' && state.data.exported_at && <p className="snapshot-caption">Snapshot based on successful sync: <time dateTime={state.data.exported_at}>{formatTimestamp(state.data.exported_at)}</time>. Observation and retrieval dates differ by source; newer releases require a refresh.</p>}
      {page !== 'calculators' && state.status === 'loading' && <section className="state-panel loading-state" role="status"><span className="loading-dot" />Loading the official data snapshot…</section>}
      {page !== 'calculators' && state.status === 'error' && <section className="state-panel error-state" role="alert"><span className="eyebrow">DATA UNAVAILABLE</span><h2>The data could not be loaded.</h2><p>{state.message}</p><button className="button button-primary" onClick={retry}>Retry</button></section>}
      {page !== 'calculators' && state.status === 'ready' && (page === 'analytics' ? <Suspense fallback={<section className="state-panel loading-state" role="status">Loading analytics…</section>}><Analytics /></Suspense> : <><IndicatorSelector indicators={state.data.indicators} selected={indicator} onChange={changeIndicator} />{page === 'compare' ? <Compare data={state.data} indicator={indicator} retry={retry} showMethodology={() => navigate('methodology')} /> : <Methodology data={state.data} indicator={indicator} />}</>)}
      {calculatorsOpened && <div hidden={page !== 'calculators'}><Suspense fallback={<section className="state-panel loading-state" role="status">Loading calculators…</section>}><Calculators active={page === 'calculators'} section={route.section} navigationVersion={navigationVersion} data={state.status === 'ready' ? state.data : undefined} onExplore={(code, section) => { setIndicatorCode(code); navigate(section); }} /></Suspense></div>}
    </main>
    <footer className="site-footer"><div><span>Baltic Home Compass</span><span>A portfolio project using official statistics.</span></div><a className="text-link" href="#methodology" onClick={event => navigate('methodology', event)}>Data & limitations</a></footer>
  </>;
}
