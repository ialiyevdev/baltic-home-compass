import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { countries, formatPeriod, indicatorDetails, statusLabel } from './data';
import type { CountryCode, Indicator } from './data';

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });

export function splitAtSeriesBreaks(data: Record<string, string | number | null>[], selected: CountryCode[]) {
  const rows = data.map(row => ({ ...row }));
  const series: { country: CountryCode; key: string }[] = [];
  const breaks = new Set<string>();
  for (const country of selected) {
    let segment = 0;
    series.push({ country, key: `${country}_0` });
    for (const row of rows) {
      if (String(row[`${country}_status`] ?? '').toLowerCase().includes('b')) {
        breaks.add(String(row.period));
        segment += 1;
        series.push({ country, key: `${country}_${segment}` });
      }
      row[`${country}_${segment}`] = row[country];
    }
  }
  return { rows, series, breaks: [...breaks] };
}

export default function ComparisonChart({ data, selected, indicator }: {
  data: Record<string, string | number | null>[];
  selected: CountryCode[];
  indicator: Indicator;
}) {
  const segmented = useMemo(() => splitAtSeriesBreaks(data, selected), [data, selected]);
  const isRate = indicator.comparison_kind === 'percentage_points' || ['hicp_annual_change', 'mortgage_borrowing_rate', 'housing_cost_overburden'].includes(indicator.code);
  const isEarnings = ['annual_net_earnings', 'median_equivalised_income', 'household_consumption_expenditure'].includes(indicator.code);
  const unit = indicatorDetails[indicator.code].valueUnit;
  return <ResponsiveContainer width="100%" height="100%" minWidth={1}>
    <LineChart data={segmented.rows} margin={{ top: 18, right: 15, left: 0, bottom: 5 }} accessibilityLayer>
      <CartesianGrid vertical={false} stroke="#e5e9e4" strokeDasharray="3 4" />
      <XAxis dataKey="period" tickFormatter={formatPeriod} axisLine={false} tickLine={false} minTickGap={50} tick={{ fill: '#65716e', fontSize: 11 }} tickMargin={14} />
      <YAxis domain={isRate ? [(minimum: number) => Math.min(0, Math.floor(minimum)), (maximum: number) => Math.max(0, Math.ceil(maximum))] : [0, 'auto']}
        tickFormatter={value => numberFormat.format(Number(value))} axisLine={false} tickLine={false} tick={{ fill: '#65716e', fontSize: 11 }} width={isEarnings ? 61 : 45} tickMargin={10} />
      {isRate && <ReferenceLine y={0} stroke="#a9b9ad" />}
      {segmented.breaks.map(period => <ReferenceLine key={period} x={period} stroke="#c6ae89" strokeDasharray="3 4" label={{ value: 'Series break', position: 'insideTopLeft', fill: '#8a775b', fontSize: 9 }} />)}
      <Tooltip labelFormatter={value => formatPeriod(String(value))}
        formatter={(value, name, item) => {
          const country = String(name);
          const flag = item.payload?.[`${country}_status`] as string | null;
          const formatted = typeof value === 'number' ? `${numberFormat.format(value)} ${unit}` : 'Unavailable';
          return [flag ? `${formatted} (${statusLabel(flag, indicator)})` : formatted, countries.find(entry => entry.code === country)?.name ?? country];
        }}
        contentStyle={{ border: '1px solid #dce2db', borderRadius: 4, fontSize: 11, boxShadow: '0 4px 16px #18352a0a' }} />
      {segmented.series.map(series => <Line key={series.key} type="linear" dataKey={series.key} name={series.country}
        stroke={countries.find(country => country.code === series.country)?.color} strokeWidth={2.5}
        dot={indicator.frequency === 'A' || data.length === 1 ? { r: 2.5 } : false}
        activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />)}
    </LineChart>
  </ResponsiveContainer>;
}
