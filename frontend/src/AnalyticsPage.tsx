import { lazy, Suspense, useEffect, useState } from 'react';
import CountrySelector, { CountrySymbol } from './CountrySelector';
import { analyticsCsv, comparisonRankings, loadAnalytics, visibleComponents } from './analytics';
import type { Analysis, AnalyticsCatalogue, AnalyticsSeries, Comparison, Ranking } from './analytics';
import { countries, formatPeriod, formatTimestamp, frequencyLabel, indicatorDetails } from './data';
import type { CountryCode } from './data';

const AnalyticsChart = lazy(() => import('./AnalyticsChart'));
const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const changeFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

function countryNames(rows: Ranking[]): string {
  return rows.map(row => countries.find(country => country.code === row.country)?.name ?? row.country).join(', ');
}

function ChangeSummary({ rankings, series, selected, base, end }: {
  rankings: Ranking[]; series: AnalyticsSeries[]; selected: CountryCode[]; base: string; end: string;
}) {
  const components = [...new Map(series.map(item => [item.component, item.label])).entries()];
  return <section className="change-summary" aria-labelledby="change-summary-title">
    <div className="section-heading"><span className="eyebrow">A SHARED PERIOD</span><h2 id="change-summary-title">Change from {formatPeriod(base)} to {formatPeriod(end)}</h2><p>These comparisons describe the selected series. A greater change is not an assessment of living standards or affordability.</p></div>
    <div className="change-components">{components.map(([component, label]) => {
      const rows = rankings.filter(row => row.component === component).sort((a, b) => a.rank - b.rank);
      const highest = rows.filter(row => row.rank === rows[0]?.rank);
      const lowest = rows.filter(row => row.rank === rows.at(-1)?.rank);
      const complete = rows.length === selected.length && rows.length > 1;
      const tied = complete && highest.length === rows.length;
      return <article className="change-component" key={component}>
        <h3>{label}</h3>
        {!complete ? <p>A compatible change is not available for every selected country.</p> : tied ? <p className="change-insight">The selected countries share the same change: <strong>{changeFormat.format(rows[0].change)} {rows[0].unit}</strong>.</p> : <div className="change-extremes">
          <p><span>Greatest change{highest.length > 1 ? ' · tied' : ''}</span><strong>{countryNames(highest)}</strong><b>{changeFormat.format(highest[0].change)} {highest[0].unit}</b></p>
          <p><span>Smallest change{lowest.length > 1 ? ' · tied' : ''}</span><strong>{countryNames(lowest)}</strong><b>{changeFormat.format(lowest[0].change)} {lowest[0].unit}</b></p>
        </div>}
        <ul className="country-changes">{countries.filter(country => selected.includes(country.code)).map(country => {
          const row = rows.find(value => value.country === country.code);
          return <li key={country.code}><span><i style={{ backgroundColor: country.color }} />{country.name}</span><strong>{row ? `${changeFormat.format(row.change)} ${row.unit}` : 'Unavailable'}</strong></li>;
        })}</ul>
      </article>;
    })}</div>
  </section>;
}

function AnalyticsTable({ comparison, series, end }: { comparison: Comparison; series: AnalyticsSeries[]; end: string }) {
  return <details className="data-details"><summary>View the aligned data <span aria-hidden="true">↗</span></summary>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Displayed analytical observations"><table>
      <caption>Calculated values use the documented alignment and base period. Aligned values are measured or combined source inputs before normalization; they are not always original API measurements.</caption>
      <thead><tr><th scope="col">Period</th><th scope="col">Country</th><th scope="col">Series</th><th scope="col">Value</th><th scope="col">Change</th><th scope="col">Aligned value</th><th scope="col">Source flags</th><th scope="col">Source periods</th><th scope="col">Availability</th></tr></thead>
      <tbody>{series.flatMap(item => item.points.filter(point => point.period >= (comparison.base_period ?? '') && point.period <= end).map(point => <tr key={`${item.country}:${item.component}:${point.period}`}>
        <th scope="row">{formatPeriod(point.period)}</th><td>{countries.find(country => country.code === item.country)?.name}</td><td>{item.label}</td>
        <td>{point.value === null ? 'Unavailable' : numberFormat.format(point.value)}</td><td>{point.change === null ? 'Unavailable' : `${changeFormat.format(point.change)} ${item.change_unit}`}</td>
        <td>{point.raw_value === null ? 'Unavailable' : `${numberFormat.format(point.raw_value)} ${item.raw_unit}`}</td><td>{point.flags.join(', ') || 'No flag'}</td><td>{point.source_periods.map(formatPeriod).join(', ') || 'Not available'}</td><td>{point.reason ?? 'Available'}</td>
      </tr>))}</tbody>
    </table></div>
  </details>;
}

function AnalysisOptions({ analyses }: { analyses: Analysis[] }) {
  const groups = [
    { label: 'Aligned housing and earnings', values: analyses.filter(analysis => analysis.metric !== 'indicator_change') },
    ...(['Housing', 'Household economy', 'Mortgage rates'] as const).map(category => ({
      label: `${category} · change from a common base`,
      values: analyses.filter(analysis => analysis.metric === 'indicator_change' && analysis.indicator && indicatorDetails[analysis.indicator]?.category === category),
    })),
  ];
  return groups.filter(group => group.values.length).map(group => <optgroup key={group.label} label={group.label}>{group.values.map(analysis => <option key={analysis.key} value={analysis.key}>{analysis.title}</option>)}</optgroup>);
}

function AnalyticsContent({ catalogue }: { catalogue: AnalyticsCatalogue }) {
  const [key, setKey] = useState('housing_earnings');
  const [selected, setSelected] = useState<CountryCode[]>(['EE', 'LV', 'LT']);
  const [base, setBase] = useState('');
  const [through, setThrough] = useState('');
  const [view, setView] = useState<'nominal' | 'real'>('nominal');
  const analysis = catalogue.analyses.find(item => item.key === key) ?? catalogue.analyses[0];
  const basePeriod = analysis?.available_bases.includes(base) ? base : analysis?.default_base;
  const comparison = analysis?.scenarios.find(scenario => scenario.base_period === basePeriod) ?? analysis?.scenarios[0];
  const endPeriods = Object.keys(comparison?.rankings_by_period ?? {}).filter(period => period > (comparison?.base_period ?? '')).sort();
  const end = endPeriods.includes(through) ? through : comparison?.end_period ?? endPeriods.at(-1) ?? '';

  function changeAnalysis(nextKey: string) {
    setKey(nextKey);
    setBase('');
    setThrough('');
    setView(catalogue.analyses.find(item => item.key === nextKey)?.metric === 'real_earnings' ? 'real' : 'nominal');
  }

  if (!analysis) return <section className="state-panel" role="status"><span className="eyebrow">NO ANALYSES EXPORTED</span><h2>There are no compatible comparisons in this snapshot.</h2><p>Refresh the official data and regenerate the static export to make supported comparisons available.</p></section>;

  const components = comparison ? visibleComponents(comparison, view) : [];
  const series = comparison?.series.filter(item => selected.includes(item.country) && components.includes(item.component)) ?? [];
  const componentLabels = [...new Map(series.map(item => [item.component, item.label])).entries()];
  const rankings = comparison ? comparisonRankings(comparison, end, selected, components) : [];
  const hasValues = series.some(item => item.points.some(point => point.period >= (comparison?.base_period ?? '') && point.period <= end && point.value !== null));

  function downloadCsv() {
    if (!comparison) return;
    const url = URL.createObjectURL(new Blob(['\uFEFF', analyticsCsv(comparison, selected, components, end)], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `baltic-analysis_${analysis.key.replaceAll(':', '-')}_${comparison.base_period}_${end}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <section className="indicator-selector analytics-selector" aria-label="Analysis selection"><label>Analysis<select value={analysis.key} onChange={event => changeAnalysis(event.target.value)}><AnalysisOptions analyses={catalogue.analyses} /></select></label><p>Published observations, aligned only where definitions permit.<br />{frequencyLabel(analysis.frequency)} comparison · All three countries share the base and end period.</p></section>
    <section className="comparison-controls" aria-label="Analytical comparison settings"><CountrySelector selected={selected} onChange={setSelected} /><div className="date-controls">
      <label>Base period<select value={comparison?.base_period ?? ''} onChange={event => { setBase(event.target.value); setThrough(''); }} disabled={!analysis.available_bases.length}>{analysis.available_bases.map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}</select></label>
      <span className="date-dash" aria-hidden="true">—</span><label>Through<select value={end} onChange={event => setThrough(event.target.value)} disabled={!endPeriods.length}>{endPeriods.map(period => <option key={period} value={period}>{formatPeriod(period)}</option>)}</select></label>
    </div></section>
    <p className="alignment-note">Base choices use the first compatible period in each year, plus a newer source-break segment where needed. Base and end periods remain common to all three countries, including a country hidden from the chart.</p>
    {(!comparison || comparison.status !== 'available' || !end) ? <section className="state-panel" role="status"><span className="eyebrow">COMPARISON UNAVAILABLE</span><h2>There are not enough compatible periods for this comparison.</h2><p>{comparison?.caveats.at(-1) ?? 'A required source or common base period is unavailable.'}</p></section> : <>
      <section className="chart-panel analytics-panel" aria-labelledby="analytics-chart-title">
        <div className="chart-toolbar"><div><span className="eyebrow">{frequencyLabel(comparison.frequency).toUpperCase()} · COMMON PERIODS</span><h2 id="analytics-chart-title">{comparison.title}</h2><p>{comparison.unit} <span aria-hidden="true">/</span> Base: {formatPeriod(comparison.base_period ?? '')}</p></div><button className="button button-outline" onClick={downloadCsv}>Export CSV</button></div>
        {['housing_inflation', 'real_earnings'].includes(comparison.metric) && <fieldset className="view-controls"><legend>View</legend><div><button aria-pressed={view === 'nominal'} onClick={() => setView('nominal')}>Nominal comparison</button><button aria-pressed={view === 'real'} onClick={() => setView('real')}>Inflation adjusted</button></div></fieldset>}
        <div className="chart-layout"><div className="chart-area">
          <p id="analytics-chart-description" className="sr-only">{comparison.title}. {comparison.unit}. From {formatPeriod(comparison.base_period ?? '')} to {formatPeriod(end)}. Selected countries: {countries.filter(country => selected.includes(country.code)).map(country => country.name).join(', ')}. Missing or incompatible values remain gaps. A data table follows the chart.</p>
          {hasValues ? <div className="chart-canvas analytics-chart-canvas" role="region" aria-label="Aligned comparison chart" aria-describedby="analytics-chart-description"><Suspense fallback={<div className="chart-empty" role="status">Loading chart…</div>}><AnalyticsChart comparison={comparison} series={series} end={end} /></Suspense></div> : <div className="chart-empty" role="status">No comparable values are available for the selected view.</div>}
          <div className="chart-legend" role="group" aria-label="Country legend">{countries.filter(country => selected.includes(country.code)).map(country => <span key={country.code}><svg className="country-symbol" viewBox="0 0 16 16" aria-hidden="true"><CountrySymbol country={country.code} cx={8} cy={8} /></svg>{country.name}</span>)}</div>
          <div className="component-legend" role="group" aria-label="Series legend">{componentLabels.map(([component, label], index) => <span key={component}><i className={index ? 'is-dashed' : ''} />{label}</span>)}</div>
          <p className="chart-help">Use the left and right arrow keys on the chart to inspect periods, or open the aligned data table below. Symbols identify countries; solid and dashed lines identify series.</p>
        </div><aside className="chart-note"><span className="note-number">01 / COMPARISON METHOD</span><h3>How the periods align</h3><p>{comparison.method}</p>{comparison.caveats.filter(caveat => /2024|HPI is|ratio|reference year|survey year/.test(caveat)).map(caveat => <p key={caveat}>{caveat}</p>)}</aside></div>
        <div className="chart-source"><span>Sources: {comparison.sources.map((source, index) => <span key={source.code}>{index > 0 ? ' · ' : ''}<a href={source.source_url} target="_blank" rel="noreferrer">{source.publisher} {source.dataset_code} ↗</a></span>)}</span><span>Export based on sync: {formatTimestamp(catalogue.exported_at)}</span></div>
        <AnalyticsTable comparison={comparison} series={series} end={end} />
      </section>
      <ChangeSummary rankings={rankings} series={series} selected={selected} base={comparison.base_period ?? ''} end={end} />
    </>}
    {comparison && <section className="analytics-methodology" aria-labelledby="analytics-methodology-title"><div className="section-heading"><span className="eyebrow">DEFINITIONS & LIMITATIONS</span><h2 id="analytics-methodology-title">What this comparison can tell us</h2></div><ul>{comparison.caveats.map(caveat => <li key={caveat}>{caveat}</li>)}</ul>
      <div className="analytics-sources">{comparison.sources.map(source => <article key={source.code}><h3>{source.name}</h3><p>{source.description}</p><dl><div><dt>Original frequency & unit</dt><dd>{frequencyLabel(source.frequency)} · {source.unit}</dd></div><div><dt>Retrieved</dt><dd>{formatTimestamp(source.retrieved_at)}</dd></div></dl><a href={source.source_url} target="_blank" rel="noreferrer">{source.publisher} · {source.dataset_code} ↗</a>{source.source_notes && <p className="small-copy">{source.source_notes}</p>}{source.status_labels && Object.keys(source.status_labels).length > 0 && <p className="small-copy">Source flags: {Object.entries(source.status_labels).map(([flag, label]) => `${flag} = ${label}`).join('; ')}.</p>}</article>)}</div>
      {!!comparison.methodology_sources?.length && <p className="methodology-links">Method references: {comparison.methodology_sources.map((source, index) => <span key={source.url}>{index > 0 ? ' · ' : ''}<a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a></span>)}</p>}
    </section>}
  </>;
}

export default function AnalyticsPage() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; catalogue: AnalyticsCatalogue }>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadAnalytics(controller.signal).then(catalogue => setState({ status: 'ready', catalogue })).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ status: 'error', message: error instanceof Error ? error.message : 'Analytics could not be loaded.' });
    });
    return () => controller.abort();
  }, [attempt]);
  if (state.status === 'loading') return <section className="state-panel loading-state" role="status"><span className="loading-dot" />Loading validated comparisons…</section>;
  if (state.status === 'error') return <section className="state-panel error-state" role="alert"><span className="eyebrow">ANALYTICS UNAVAILABLE</span><h2>The comparisons could not be loaded.</h2><p>{state.message}</p><button className="button button-primary" onClick={() => setAttempt(value => value + 1)}>Retry analytics</button></section>;
  return <AnalyticsContent catalogue={state.catalogue} />;
}
