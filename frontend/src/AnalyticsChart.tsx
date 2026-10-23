import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { countries, formatPeriod } from './data';
import type { AnalyticsSeries, Comparison } from './analytics';

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

export default function AnalyticsChart({ comparison, series, end }: { comparison: Comparison; series: AnalyticsSeries[]; end: string }) {
  const periods = [...new Set(series.flatMap(item => item.points.map(point => point.period)))].sort()
    .filter(period => period >= (comparison.base_period ?? '') && period <= end);
  const components = [...new Set(series.map(item => item.component))];
  const data = periods.map(period => {
    const row: Record<string, string | number | null> = { period };
    for (const item of series) row[`${item.country}:${item.component}`] = item.points.find(point => point.period === period)?.value ?? null;
    return row;
  });
  const percentagePoints = series[0]?.change_unit === 'pp';

  return <ResponsiveContainer width="100%" height="100%" minWidth={1}>
    <LineChart data={data} margin={{ top: 18, right: 15, left: 0, bottom: 5 }} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="#e5e9e4" strokeDasharray="3 4" />
      <XAxis dataKey="period" tickFormatter={formatPeriod} minTickGap={50} axisLine={false} tickLine={false} tickMargin={14} tick={{ fill: '#65716e', fontSize: 11 }} />
      <YAxis domain={['auto', 'auto']} axisLine={false} tickLine={false} width={46} tickMargin={10} tick={{ fill: '#65716e', fontSize: 11 }} tickFormatter={value => numberFormat.format(Number(value))} />
      <ReferenceLine y={percentagePoints ? 0 : 100} stroke="#acbbae" strokeDasharray="4 4" />
      <Tooltip content={({ active, label }) => {
        if (!active || label === undefined) return null;
        return <div className="analytics-tooltip"><strong>{formatPeriod(String(label))}</strong>{series.map(item => {
          const point = item.points.find(value => value.period === label);
          const flags = point?.flags.map(flag => {
            const labels = [...new Set(comparison.sources.flatMap(source => [...flag].map(code => source.status_labels?.[code]).filter(Boolean)))];
            return labels.length ? `${flag}: ${labels.join('; ')}` : flag;
          }).join(', ');
          return <div key={`${item.country}:${item.component}`}>
            <span style={{ color: countries.find(country => country.code === item.country)?.color }}>{countries.find(country => country.code === item.country)?.name} · {item.label}</span>
            <b>{point?.value === null || point?.value === undefined ? 'Unavailable' : numberFormat.format(point.value)}{flags ? ` [${flags}]` : ''}</b>
            {point?.reason && <small>{point.reason}</small>}
          </div>;
        })}</div>;
      }} />
      {series.map(item => <Line key={`${item.country}:${item.component}`} type="linear" dataKey={`${item.country}:${item.component}`}
        stroke={countries.find(country => country.code === item.country)?.color}
        strokeDasharray={components.indexOf(item.component) === 0 ? undefined : '6 4'}
        strokeWidth={2.3} dot={comparison.frequency === 'A' || periods.length === 1 ? { r: 2.2 } : false}
        activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
    </LineChart>
  </ResponsiveContainer>;
}
