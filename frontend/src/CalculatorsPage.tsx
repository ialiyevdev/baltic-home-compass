import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  apiCalculationEnabled, calculateMortgage, CalculationMismatchError, checkCalculator, InputError,
} from './finance';
import type { CalculatorResult, MortgageInput } from './finance';
import { countries, formatPeriod, formatTimestamp } from './data';
import type { CountryCode, DataBundle, IndicatorCode } from './data';
import { mortgageBenchmark } from './mortgageBenchmark';

const CalculatorChart = lazy(() => import('./CalculatorChart'));
const euro = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const euroChange = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'exceptZero' });
const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
const rate = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 6, signDisplay: 'auto' });
const change = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2, signDisplay: 'exceptZero' });

interface FormValues {
  country: CountryCode;
  property_price: string;
  down_payment_mode: 'amount' | 'percent';
  down_payment_value: string;
  annual_rate: string;
  term_years: string;
  monthly_property_expenses: string;
  one_time_costs: string;
  monthly_income: string;
  monthly_debts: string;
  monthly_living_expenses: string;
  housing_threshold: string;
  desired_monthly_payment: string;
  rate_offsets: string;
}

const initialValues: FormValues = {
  country: 'LV', property_price: '150000', down_payment_mode: 'percent', down_payment_value: '20',
  annual_rate: '4', term_years: '25', monthly_property_expenses: '', one_time_costs: '',
  monthly_income: '', monthly_debts: '', monthly_living_expenses: '', housing_threshold: '30',
  desired_monthly_payment: '600', rate_offsets: '-1, 1, 2, 3',
};

function readNumber(value: string, field: string, optional = false): number {
  if (!value.trim()) {
    if (optional) return 0;
    throw new InputError(field, 'Enter a number for this assumption.');
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new InputError(field, 'Enter a finite number.');
  return parsed;
}

function scenarioInput(values: FormValues): MortgageInput {
  return {
    spec_version: '1', country: values.country,
    property_price: readNumber(values.property_price, 'property_price'),
    down_payment: { mode: values.down_payment_mode, value: readNumber(values.down_payment_value, 'down_payment.value') },
    annual_rate: readNumber(values.annual_rate, 'annual_rate'),
    term_years: readNumber(values.term_years, 'term_years'),
    monthly_property_expenses: readNumber(values.monthly_property_expenses, 'monthly_property_expenses', true),
    one_time_costs: readNumber(values.one_time_costs, 'one_time_costs', true),
    monthly_income: values.monthly_income.trim() ? readNumber(values.monthly_income, 'monthly_income') : null,
    monthly_debts: readNumber(values.monthly_debts, 'monthly_debts', true),
    monthly_living_expenses: readNumber(values.monthly_living_expenses, 'monthly_living_expenses', true),
    housing_threshold: readNumber(values.housing_threshold, 'housing_threshold'),
    desired_monthly_payment: readNumber(values.desired_monthly_payment, 'desired_monthly_payment'),
    rate_offsets: values.rate_offsets.trim() ? values.rate_offsets.split(',').map(value => readNumber(value, 'rate_offsets')) : [],
  };
}

function NumericField({ label, name, value, onChange, hint, error, optional = false }: {
  label: string; name: string; value: string; onChange: (value: string) => void;
  hint?: string; error?: InputError | null; optional?: boolean;
}) {
  const id = `calculator-${name.replaceAll('.', '-')}`;
  const invalid = error?.field === name;
  return <div className={`calculator-field ${invalid ? 'has-error' : ''}`}>
    <label htmlFor={id}>{label}{optional && <span>Optional</span>}</label>
    <input id={id} name={name} type="number" inputMode="decimal" step="any" min="0" value={value}
      onChange={event => onChange(event.target.value)} aria-invalid={invalid || undefined}
      aria-describedby={[hint ? `${id}-hint` : '', invalid ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined} />
    {hint && <p id={`${id}-hint`}>{hint}</p>}
    {invalid && <p id={`${id}-error`} className="field-error">{error.message}</p>}
  </div>;
}

function ScenarioFacts({ result }: { result: CalculatorResult }) {
  const mortgage = result.mortgage;
  return <div className="mortgage-results" aria-label="Mortgage results">
    <span className="eyebrow">YOUR ENTERED SCENARIO</span>
    <div className="mortgage-main-value"><span>Monthly principal & interest</span><strong>{euro.format(mortgage.monthly_payment)}</strong></div>
    <div className="mortgage-second-value"><span>Housing outflow / month</span><strong>{euro.format(mortgage.monthly_housing_outflow)}</strong><p>Mortgage payment plus the property expenses you entered.</p></div>
    <dl className="calculator-facts">
      <div><dt>Down payment</dt><dd>{euro.format(mortgage.down_payment)}</dd></div>
      <div><dt>Initial loan principal</dt><dd>{euro.format(mortgage.loan_principal)}</dd></div>
      <div><dt>Loan to value</dt><dd>{mortgage.loan_to_value === null ? 'Not defined for a zero price' : `${number.format(mortgage.loan_to_value)}%`}</dd></div>
      <div><dt>Initial cash required</dt><dd>{euro.format(mortgage.initial_cash)}</dd></div>
      <div><dt>Total mortgage repayment</dt><dd>{euro.format(mortgage.total_repayment)}</dd></div>
      <div><dt>Total mortgage interest</dt><dd>{euro.format(mortgage.total_interest)}</dd></div>
      <div><dt>Number of repayments</dt><dd>{mortgage.number_of_payments}</dd></div>
      <div><dt>Final repayment</dt><dd>{euro.format(mortgage.final_payment)}</dd></div>
    </dl>
    <p className="calculator-small-copy">Initial cash includes the down payment and entered one-time costs. The final repayment reconciles rounding and can differ from the regular payment; totals sum the actual schedule.</p>
    {mortgage.final_payment > mortgage.monthly_payment * 1.1 + 1 && <p className="calculator-notice notice-warning">The final repayment is larger than the regular payment. At extreme rates or long terms, cent rounding can leave principal to clear at the end. Review the full schedule.</p>}
    {mortgage.loan_principal === 0 && <p className="calculator-notice">This is a full cash purchase under your inputs. No mortgage repayments are required; entered property expenses still apply.</p>}
  </div>;
}

function Benchmark({ data, country }: { data?: DataBundle; country: CountryCode }) {
  const benchmark = mortgageBenchmark(data, country);
  return <aside className="calculator-benchmark" aria-labelledby="benchmark-title">
    <span className="eyebrow">OFFICIAL STATISTICAL CONTEXT</span>
    <h3 id="benchmark-title">ECB borrowing-cost benchmark</h3>
    {benchmark.status === 'available' && benchmark.value !== null ? <p className="benchmark-value"><strong>{rate.format(benchmark.value)}%</strong><span>{countries.find(item => item.code === country)?.name} · {benchmark.period ? formatPeriod(benchmark.period) : 'Period unavailable'} · AAR / NDER</span></p> : <p className="calculator-small-copy">{benchmark.reason ?? 'The benchmark is unavailable. Your manually entered rate still works.'}</p>}
    <p>This benchmark is for context. It is not the nominal annual rate used in the calculator or a personal bank offer. Enter your own nominal annual rate.</p>
    {benchmark.flag && <p>Source flag: <code>{benchmark.flag}</code></p>}
    {benchmark.retrieved_at && <p>Retrieved {formatTimestamp(benchmark.retrieved_at)}</p>}
    {benchmark.source_url && <a href={benchmark.source_url} target="_blank" rel="noreferrer">ECB MIR · Official series ↗</a>}
    {benchmark.notes.map(note => <p className="benchmark-note" key={note}>{note}</p>)}
  </aside>;
}

type Verification = { state: 'local' | 'pending' | 'matched' } | { state: 'error' | 'mismatch'; message: string };

export default function CalculatorsPage({ data, active = true, section, navigationVersion = 0, onExplore }: {
  data?: DataBundle;
  active?: boolean;
  section?: string;
  navigationVersion?: number;
  onExplore: (indicator: IndicatorCode, section: 'compare' | 'analytics' | 'methodology') => void;
}) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [verification, setVerification] = useState<Verification>({ state: apiCalculationEnabled ? 'pending' : 'local' });
  const [scheduleView, setScheduleView] = useState<'annual' | 'monthly'>('annual');
  const [chartView, setChartView] = useState<'balance' | 'payments' | 'mix'>('balance');
  const calculation = useMemo(() => {
    try {
      const input = scenarioInput(values);
      return { input, result: calculateMortgage(input), error: null };
    } catch (error) {
      return { input: null, result: null, error: error instanceof InputError ? error : new InputError('scenario', error instanceof Error ? error.message : 'The scenario could not be calculated.') };
    }
  }, [values]);
  const { input, result, error } = calculation;

  useEffect(() => {
    if (!active || !input || !result) return;
    if (!apiCalculationEnabled) {
      setVerification({ state: 'local' });
      return;
    }
    const controller = new AbortController();
    setVerification({ state: 'pending' });
    const timer = setTimeout(() => {
      checkCalculator(input, result, controller.signal).then(() => {
        if (!controller.signal.aborted) setVerification({ state: 'matched' });
      }).catch((cause: unknown) => {
        if (!controller.signal.aborted) setVerification({ state: cause instanceof CalculationMismatchError ? 'mismatch' : 'error', message: cause instanceof Error ? cause.message : 'The calculation API could not be reached.' });
      });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [input, result, active]);

  function update(field: keyof FormValues, value: string) {
    setValues(previous => ({ ...previous, [field]: value }));
  }

  const affordability = result?.affordability;
  const reverse = result?.reverse_budget;
  const schedule = result ? scheduleView === 'annual' ? result.annual_schedule : result.schedule : [];

  useEffect(() => {
    if (!active || !section) return;
    const heading = document.getElementById(`${section}-title`);
    heading?.focus();
    heading?.scrollIntoView?.({ block: 'start' });
  }, [active, section, navigationVersion]);

  return <div className="calculators-page">
    <div className="calculator-introduction"><p><strong>Illustrative inputs, not market averages.</strong> Change the example purchase price, rate, term and down payment to describe your own scenario. Income starts blank.</p><p>Inputs stay in memory for this page session. {apiCalculationEnabled ? 'API mode sends the scenario to the configured calculation API for a consistency check; it is not stored.' : 'This static build calculates in your browser without sending your scenario.'}</p></div>
    <nav className="calculator-sections" aria-label="Calculator sections"><a href="#calculators/mortgage-calculator">Mortgage</a><a href="#calculators/household-calculator">Household budget</a><a href="#calculators/purchase-budget">Purchase budget</a><a href="#calculators/rate-scenarios">Rate scenarios</a><a href="#calculators/amortization">Amortization</a></nav>

    <section id="mortgage-calculator" className="calculator-section" aria-labelledby="mortgage-calculator-title">
      <div className="section-heading"><span className="eyebrow">01 / PURCHASE & LOAN</span><h2 id="mortgage-calculator-title" tabIndex={-1}>Mortgage calculator</h2><p>A constant nominal annual rate, monthly payments and full amortization. Fees are excluded from the interest rate and added only through your cost inputs.</p></div>
      <div className="mortgage-layout"><div className="mortgage-inputs">
        <div className="calculator-field"><label htmlFor="calculator-country">Country for benchmark context</label><select id="calculator-country" value={values.country} onChange={event => update('country', event.target.value)}>{countries.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select><p>Country does not change formulas, costs or borrowing limits.</p></div>
        <div className="calculator-form-grid">
          <NumericField name="property_price" label="Purchase price (EUR)" value={values.property_price} onChange={value => update('property_price', value)} error={error} />
          <div className="calculator-field"><label htmlFor="calculator-down-mode">Down payment unit</label><select id="calculator-down-mode" value={values.down_payment_mode} onChange={event => setValues(previous => ({ ...previous, down_payment_mode: event.target.value as FormValues['down_payment_mode'], down_payment_value: '' }))}><option value="percent">Percent of purchase price</option><option value="amount">Amount in EUR</option></select><p>Changing units clears the value so you can enter the new assumption explicitly.</p></div>
          <NumericField name="down_payment.value" label={values.down_payment_mode === 'percent' ? 'Down payment (%)' : 'Down payment (EUR)'} value={values.down_payment_value} onChange={value => update('down_payment_value', value)} error={error} />
          <NumericField name="annual_rate" label="Nominal annual interest rate (%)" value={values.annual_rate} onChange={value => update('annual_rate', value)} hint="Your fixed-rate assumption, not APRC or an effective annual rate." error={error} />
          <NumericField name="term_years" label="Mortgage term (years)" value={values.term_years} onChange={value => update('term_years', value)} hint="From one month to 60 years, in whole months. For example, 25.5 years is 306 months." error={error} />
          <NumericField name="monthly_property_expenses" label="Additional property costs / month (EUR)" value={values.monthly_property_expenses} onChange={value => update('monthly_property_expenses', value)} optional hint="Your taxes, insurance, maintenance or service costs. Blank excludes them." error={error} />
          <NumericField name="one_time_costs" label="One-time purchase costs (EUR)" value={values.one_time_costs} onChange={value => update('one_time_costs', value)} optional hint="Your fees and other purchase costs, excluding the down payment. Blank means zero." error={error} />
        </div>
        <Benchmark data={data} country={values.country} />
      </div><div>
        {error ? <div className="calculator-validation" role="alert"><h3>Check the scenario inputs</h3><p>{error.message}</p><p>Results remain hidden until the inputs are valid.</p></div> : result && <><ScenarioFacts result={result} />
          <div className={`calculation-verification ${verification.state}`} role="status">
            {verification.state === 'local' && 'Calculated in this browser. No scenario data sent.'}
            {verification.state === 'pending' && 'Browser results are ready. Checking the calculation API…'}
            {verification.state === 'matched' && 'Browser and API calculations agree.'}
            {verification.state === 'error' && <>API check unavailable. These are browser-calculated results.<span>{verification.message}</span></>}
            {verification.state === 'mismatch' && <>The browser and API calculations disagree. These displayed browser results are unverified.<span>{verification.message}</span></>}
          </div>
        </>}
      </div></div>
    </section>

    <section id="household-calculator" className="calculator-section" aria-labelledby="household-calculator-title"><div className="section-heading"><span className="eyebrow">02 / YOUR MONTHLY BUDGET</span><h2 id="household-calculator-title" tabIndex={-1}>Household affordability</h2><p>Use your actual monthly net household income and entered expenses. The reference percentage is your own scenario assumption, not an official lending limit.</p></div>
      <div className="calculator-form-grid household-inputs">
        <NumericField name="monthly_income" label="Monthly net household income (EUR)" value={values.monthly_income} onChange={value => update('monthly_income', value)} optional hint="Blank leaves income-based results unavailable. Zero is treated as an entered zero." error={error} />
        <NumericField name="monthly_debts" label="Existing debt payments / month (EUR)" value={values.monthly_debts} onChange={value => update('monthly_debts', value)} optional hint="Other debts, excluding this mortgage. Blank means zero." error={error} />
        <NumericField name="monthly_living_expenses" label="Non-housing living expenses / month (EUR)" value={values.monthly_living_expenses} onChange={value => update('monthly_living_expenses', value)} optional hint="Your total for living expenses. No national average is inserted." error={error} />
        <NumericField name="housing_threshold" label="Personal housing-outflow reference (%)" value={values.housing_threshold} onChange={value => update('housing_threshold', value)} hint="Applies to mortgage payment plus entered property costs, divided by income." error={error} />
      </div>
      {affordability && result && <div className="household-results" aria-label="Household budget results"><dl className="calculator-facts">
        <div><dt>Monthly mortgage payment</dt><dd>{euro.format(result.mortgage.monthly_payment)}</dd></div>
        <div><dt>Mortgage / net income</dt><dd>{affordability.mortgage_to_income === null ? 'Enter positive income' : `${number.format(affordability.mortgage_to_income)}%`}</dd></div>
        <div><dt>Mortgage + existing debts / net income</dt><dd>{affordability.debt_to_income === null ? 'Enter positive income' : `${number.format(affordability.debt_to_income)}%`}</dd></div>
        <div><dt>Total housing outflow / net income</dt><dd>{affordability.housing_to_income === null ? 'Enter positive income' : `${number.format(affordability.housing_to_income)}%`}</dd></div>
        <div><dt>Income remaining after entered expenses</dt><dd className={affordability.remaining_income !== null && affordability.remaining_income < 0 ? 'negative-budget' : ''}>{affordability.remaining_income === null ? 'Enter income' : euro.format(affordability.remaining_income)}</dd></div>
        <div><dt>Savings for down payment + one-time costs</dt><dd>{euro.format(result.mortgage.initial_cash)}</dd></div>
      </dl>
        {affordability.threshold_exceeded !== null && <p className={`calculator-notice ${affordability.threshold_exceeded ? 'notice-warning' : ''}`}>{affordability.threshold_exceeded ? 'Housing outflow exceeds' : 'Housing outflow is within'} your selected {number.format(affordability.threshold)}% reference. This comparison does not determine loan eligibility.</p>}
        {affordability.remaining_income !== null && affordability.remaining_income < 0 && <p className="calculator-notice notice-warning" role="status">The entered mortgage, property costs, debts and living expenses exceed household income.</p>}
        {affordability.monthly_income === null && <p className="calculator-small-copy">Income-based results remain unavailable until you enter income. Official earnings and equivalised-income statistics are not used as your household income.</p>}
      </div>}
    </section>

    <section id="purchase-budget" className="calculator-section" aria-labelledby="purchase-budget-title"><div className="section-heading"><span className="eyebrow">03 / WORK BACK FROM A PAYMENT</span><h2 id="purchase-budget-title" tabIndex={-1}>Purchase budget</h2><p>Find the loan and illustrative purchase price supported by a chosen regular monthly principal-and-interest payment, using the rate, term and down-payment assumption above.</p></div>
      <div className="purchase-budget-layout"><NumericField name="desired_monthly_payment" label="Desired maximum mortgage payment / month (EUR)" value={values.desired_monthly_payment} onChange={value => update('desired_monthly_payment', value)} hint="Principal and interest only. Additional property costs are excluded from this payment target." error={error} />
        {reverse?.status === 'available' ? <div className="reverse-results" aria-label="Purchase budget results"><dl className="calculator-facts">
          <div><dt>Supported loan principal</dt><dd>{euro.format(reverse.loan_principal!)}</dd></div><div><dt>Illustrative purchase price</dt><dd>{euro.format(reverse.property_price!)}</dd></div><div><dt>Required down payment</dt><dd>{euro.format(reverse.down_payment!)}</dd></div><div><dt>Regular mortgage payment</dt><dd>{euro.format(reverse.monthly_payment!)}</dd></div><div><dt>Total interest</dt><dd>{euro.format(reverse.total_interest!)}</dd></div><div><dt>Total mortgage repayment</dt><dd>{euro.format(reverse.total_repayment!)}</dd></div>
        </dl><p className="calculator-small-copy">The final payment may differ after rounding. This is a payment-based illustration with no additional bank lending rules.</p><button className="button button-outline" disabled={reverse.property_price! > 1e9} onClick={() => update('property_price', String(reverse.property_price))}>Use this purchase price in the scenario</button>{reverse.property_price! > 1e9 && <p className="calculator-small-copy">This reverse result exceeds the EUR 1 billion input limit for the main scenario.</p>}</div> : reverse && <p className="calculator-notice notice-warning" role="status">{reverse.reason}</p>}
      </div>
    </section>

    <section id="rate-scenarios" className="calculator-section" aria-labelledby="rate-scenarios-title"><div className="section-heading"><span className="eyebrow">04 / COMPARE CONSTANT RATES</span><h2 id="rate-scenarios-title" tabIndex={-1}>Interest rate scenarios</h2><p>Every row applies a constant rate to the same initial principal and full term. These are alternative scenarios, not forecasts or a simulation of a rate reset part way through a mortgage.</p></div>
      <div className="calculator-field rate-offset-field"><label htmlFor="calculator-rate-offsets">Rate changes to compare (percentage points)</label><input id="calculator-rate-offsets" type="text" value={values.rate_offsets} onChange={event => update('rate_offsets', event.target.value)} aria-invalid={error?.field === 'rate_offsets' || undefined} aria-describedby={`calculator-rate-offsets-hint${error?.field === 'rate_offsets' ? ' calculator-rate-offsets-error' : ''}`} /><p id="calculator-rate-offsets-hint">Comma-separated differences from the base rate, for example −1, 1, 2, 3. The base case is always included; blank compares only the base.</p>{error?.field === 'rate_offsets' && <p id="calculator-rate-offsets-error" className="field-error">{error.message}</p>}</div>
      {result && <div className="table-scroll calculator-table-scroll" tabIndex={0} role="region" aria-label="Interest rate scenario comparison"><table><caption>Differences are relative to the base case. Payment-to-income uses mortgage principal and interest only; ratio differences are percentage points.</caption><thead><tr><th scope="col">Annual nominal rate</th><th scope="col">Monthly payment</th><th scope="col">Total interest</th><th scope="col">Total repayment</th><th scope="col">Payment / income</th></tr></thead><tbody>{result.rate_scenarios.map(scenario => <tr key={scenario.offset} className={scenario.offset === 0 ? 'base-scenario' : ''}>
        <th scope="row">{rate.format(scenario.annual_rate)}%<small>{scenario.offset === 0 ? 'Base case' : `${change.format(scenario.offset)} pp`}</small></th>
        {scenario.status === 'available' ? <><td>{euro.format(scenario.monthly_payment!)}<small>Δ {euroChange.format(scenario.payment_difference!)}</small></td><td>{euro.format(scenario.total_interest!)}<small>Δ {euroChange.format(scenario.total_interest_difference!)}</small></td><td>{euro.format(scenario.total_repayment!)}<small>Δ {euroChange.format(scenario.total_repayment_difference!)}</small></td><td>{scenario.mortgage_to_income === null ? 'Income not available' : `${number.format(scenario.mortgage_to_income)}%`}{scenario.ratio_difference !== null && <small>Δ {change.format(scenario.ratio_difference)} pp</small>}</td></> : <td colSpan={4}>Unavailable: {scenario.reason}</td>}
      </tr>)}</tbody></table></div>}
    </section>

    <section id="amortization" className="calculator-section" aria-labelledby="amortization-title"><div className="section-heading"><span className="eyebrow">05 / HOW THE LOAN IS REPAID</span><h2 id="amortization-title" tabIndex={-1}>Amortization schedule</h2><p>Payments reconcile to cents each month. The final payment clears the remaining balance; an annual row contains up to twelve monthly payments.</p></div>
      {result && result.schedule.length > 0 ? <div className="amortization-panel"><div className="calculator-view-buttons" aria-label="Repayment visualization"><button aria-pressed={chartView === 'balance'} onClick={() => setChartView('balance')}>Remaining balance</button><button aria-pressed={chartView === 'payments'} onClick={() => setChartView('payments')}>Annual payments</button><button aria-pressed={chartView === 'mix'} onClick={() => setChartView('mix')}>Repayment mix</button></div>
        <p id="repayment-chart-description" className="chart-help">{chartView === 'balance' ? 'Remaining principal after each year, starting at the initial loan.' : chartView === 'payments' ? 'Annual principal and interest payments. Hatched bars identify interest.' : 'Total principal and interest over the full term. Hatched bars identify interest.'} Use the arrow keys on the chart to inspect values, or open the repayment schedule below for exact amounts.</p>
        {active && <div className="calculator-chart" role="region" aria-label="Mortgage repayment chart" aria-describedby="repayment-chart-description"><Suspense fallback={<p className="chart-empty" role="status">Loading chart…</p>}><CalculatorChart result={result} view={chartView} /></Suspense></div>}
        <div className="repayment-totals"><p><span>Loan principal</span><strong>{euro.format(result.mortgage.loan_principal)}</strong></p><p><span>Total interest</span><strong>{euro.format(result.mortgage.total_interest)}</strong></p><p><span>Final payment</span><strong>{euro.format(result.mortgage.final_payment)}</strong></p></div>
        <details className="data-details"><summary>View the repayment schedule <span aria-hidden="true">↗</span></summary><div className="schedule-controls"><label>Schedule view<select value={scheduleView} onChange={event => setScheduleView(event.target.value as 'annual' | 'monthly')}><option value="annual">Annual summary</option><option value="monthly">Monthly payments</option></select></label><p>Periods count from the first payment, without an assumed calendar start date.</p></div><div className="table-scroll calculator-schedule-scroll" tabIndex={0} role="region" aria-label="Mortgage amortization table"><table><caption>{scheduleView === 'annual' ? 'Annual payment groups' : 'Monthly payments'}. Final balance: {euro.format(result.schedule.at(-1)!.balance)}.</caption><thead><tr><th scope="col">{scheduleView === 'annual' ? 'Year' : 'Month'}</th><th scope="col">Payment</th><th scope="col">Principal repaid</th><th scope="col">Interest paid</th><th scope="col">Balance</th><th scope="col">Cumulative interest</th></tr></thead><tbody>{schedule.map(row => <tr key={'year' in row ? row.year : row.month}><th scope="row">{'year' in row ? row.year : row.month}</th><td>{euro.format(row.payment)}</td><td>{euro.format(row.principal)}</td><td>{euro.format(row.interest)}</td><td>{euro.format(row.balance)}</td><td>{euro.format(row.cumulative_interest)}</td></tr>)}</tbody></table></div></details>
      </div> : result && <p className="calculator-notice">A zero loan principal has no mortgage repayment schedule.</p>}
    </section>

    <section className="calculator-context"><h2>Keep the statistical context separate</h2><p>House price and rent indices show changes, not an asking price or rent for a home. Equivalised income is not your household’s monthly take-home income. No country-specific fees, taxes or lending limits are inserted.</p><div><button className="text-link" onClick={() => onExplore('house_price_index', 'compare')}>House price trends ↗</button><button className="text-link" onClick={() => onExplore('median_equivalised_income', 'methodology')}>Income definitions ↗</button><button className="text-link" onClick={() => onExplore('housing_cost_overburden', 'compare')}>Housing-cost pressure ↗</button><button className="text-link" onClick={() => onExplore('house_price_index', 'analytics')}>Country analytics ↗</button></div><p className="calculator-small-copy">These educational scenarios do not provide personalised financial advice or a mortgage eligibility decision. Real offers can include variable rates and costs that are not represented unless entered.</p>
      <details className="calculator-method"><summary>Calculation method and limits</summary><p>For loan principal P, monthly rate r = nominal annual percentage ÷ 1200, and n monthly payments: <code>M = P × r / (1 − (1 + r)^(−n))</code>. At 0% interest, M = P ÷ n. The reverse calculation solves this same equation for P, then adds your fixed down payment or divides by the financed percentage.</p><p>Monthly interest is calculated on the outstanding balance and rounded half up to cents. The final payment clears that balance; total repayment sums actual payments. No interest is added to your one-time costs. Mortgage-to-income includes principal and interest; the personal housing reference also includes entered property expenses.</p><p>Amounts allow two decimal places, up to EUR 1 billion per input. Rates allow six decimal places, between 0% and 100%, and terms contain 1 to 720 whole months. Reverse prices above EUR 1 trillion are unavailable. These are calculation limits, not lending rules. The rate stays constant; future rate resets, early repayments and future price changes are outside this scenario.</p></details>
    </section>
  </div>;
}
