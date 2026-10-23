import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { CalculatorResult } from './finance';

const euros = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const axisValue = (value: number) => new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
const tooltipStyle = { border: '1px solid #dce4d6', borderRadius: 3, fontSize: 12, padding: 12 };

export default function CalculatorChart({ result, view }: { result: CalculatorResult; view: 'balance' | 'payments' | 'mix' }) {
  const annual = result.annual_schedule;
  const balance = [{ year: 0, balance: result.mortgage.loan_principal }, ...annual];
  const margin = { top: 15, right: 18, bottom: 18, left: 12 };
  const yAxis = <YAxis tickFormatter={axisValue} tick={{ fontSize: 10, fill: '#788771' }} width={62} axisLine={false} tickLine={false} label={{ value: 'EUR', position: 'insideTopLeft', offset: 0, fill: '#788771', fontSize: 10 }} />;
  const grid = <CartesianGrid vertical={false} stroke="#e9eee4" strokeDasharray="3 4" />;
  const tooltip = <Tooltip formatter={value => euros.format(Number(value))} labelFormatter={label => view === 'mix' ? String(label) : `Year ${label}`} contentStyle={tooltipStyle} />;
  return <ResponsiveContainer width="100%" height="100%" minWidth={0} initialDimension={{ width: 600, height: 290 }}>
    {view === 'balance' ? <LineChart data={balance} margin={margin} accessibilityLayer>
      {grid}{yAxis}<XAxis dataKey="year" tick={{ fontSize: 10, fill: '#788771' }} axisLine={false} tickLine={false} label={{ value: 'Years from first payment', position: 'insideBottom', offset: -12, fontSize: 10, fill: '#788771' }} />{tooltip}
      <Line dataKey="balance" name="Remaining principal" type="linear" dot={false} stroke="#28766b" strokeWidth={2} isAnimationActive={false} />
    </LineChart> : view === 'payments' ? <BarChart data={annual} margin={margin} accessibilityLayer>
      {grid}{yAxis}<XAxis dataKey="year" tick={{ fontSize: 10, fill: '#788771' }} axisLine={false} tickLine={false} />{tooltip}<Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="principal" name="Principal repaid / year" stackId="payment" fill="#28766b" isAnimationActive={false} />
      <Bar dataKey="interest" name="Interest paid / year" stackId="payment" fill="#bc9c73" isAnimationActive={false} />
    </BarChart> : <BarChart data={[{ category: 'Full loan term', principal: result.mortgage.loan_principal, interest: result.mortgage.total_interest }]} margin={margin} accessibilityLayer>
      {grid}{yAxis}<XAxis dataKey="category" tick={{ fontSize: 11, fill: '#788771' }} axisLine={false} tickLine={false} />{tooltip}<Legend wrapperStyle={{ fontSize: 11 }} />
      <Bar dataKey="principal" name="Total principal" fill="#28766b" isAnimationActive={false} maxBarSize={100} />
      <Bar dataKey="interest" name="Total interest" fill="#bc9c73" isAnimationActive={false} maxBarSize={100} />
    </BarChart>}
  </ResponsiveContainer>;
}
