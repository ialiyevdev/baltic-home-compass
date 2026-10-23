import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CalculatorsPage from './CalculatorsPage';
import { CalculationMismatchError } from './finance';

const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('./finance', async importOriginal => ({ ...await importOriginal<typeof import('./finance')>(), apiCalculationEnabled: true, checkCalculator: verify }));
vi.mock('./CalculatorChart', () => ({ default: () => <div data-testid="calculator-chart" /> }));

beforeEach(() => { verify.mockReset().mockResolvedValue('matched'); });
function field(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } }); }
function setup() { const explore = vi.fn(); render(<CalculatorsPage onExplore={explore} />); return explore; }

describe('linked housing scenario', () => {
  it('labels example assumptions and keeps income and unavailable statistics separate', () => {
    setup();
    expect(screen.getByText('Illustrative inputs, not market averages.')).toBeVisible();
    expect(screen.getByLabelText(/Monthly net household income/)).toHaveValue(null);
    expect(screen.getByLabelText('Mortgage results')).toHaveTextContent('€633.40');
    expect(screen.getByText(/Official benchmark data is not loaded/)).toBeVisible();
    expect(screen.getByText(/not the nominal annual rate used in the calculator/)).toBeVisible();
  });

  it('updates zero-interest payments and full-cash purchases immediately', () => {
    setup();
    field('Nominal annual interest rate (%)', '0');
    expect(screen.getByLabelText('Mortgage results')).toHaveTextContent('€400.00');
    field('Down payment (%)', '100');
    expect(screen.getByLabelText('Mortgage results')).toHaveTextContent('No mortgage repayments are required');
    expect(screen.getByText('A zero loan principal has no mortgage repayment schedule.')).toBeVisible();
    expect(screen.getByText(/A 100% down payment does not identify/)).toBeVisible();
  });

  it('calls out a substantial final reconciliation at extreme inputs', () => {
    setup();
    expect(screen.queryByText(/The final repayment is larger/)).not.toBeInTheDocument();
    field('Mortgage term (years)', '60');
    field('Nominal annual interest rate (%)', '100');
    expect(screen.getByText(/The final repayment is larger/)).toBeVisible();
  });

  it('accounts for entered household costs and shows negative remaining income', () => {
    setup();
    field('Monthly net household income (EUR)', '1000');
    field('Existing debt payments / month (EUR)', '1200');
    field('Non-housing living expenses / month (EUR)', '500');
    field('Additional property costs / month (EUR)', '100');
    field('One-time purchase costs (EUR)', '2500');
    const budget = screen.getByLabelText('Household budget results');
    expect(budget).toHaveTextContent('-€1,433.40');
    expect(budget).toHaveTextContent('183.34%');
    expect(budget).toHaveTextContent('€32,500.00');
    expect(budget).toHaveTextContent('Housing outflow exceeds your selected 30% reference');
    field('Personal housing-outflow reference (%)', '90');
    expect(budget).toHaveTextContent('Housing outflow is within your selected 90% reference');
    field('Monthly net household income (EUR)', '0');
    expect(budget).toHaveTextContent('Enter positive income');
    expect(budget).not.toHaveTextContent('NaN');
  });

  it('hides invalid results and associates the error with the field', () => {
    setup();
    field('Nominal annual interest rate (%)', '-1');
    expect(screen.getByRole('alert')).toHaveTextContent('Check the scenario inputs');
    expect(screen.getByLabelText('Nominal annual interest rate (%)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByLabelText('Mortgage results')).not.toBeInTheDocument();
    field('Nominal annual interest rate (%)', '4');
    expect(screen.getByLabelText('Mortgage results')).toBeVisible();
    field('Purchase price (EUR)', '');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a number');
  });

  it('requires a new explicit down payment when units change', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Down payment unit'), { target: { value: 'amount' } });
    expect(screen.getByLabelText('Down payment (EUR)')).toHaveValue(null);
    field('Down payment (EUR)', '30000');
    expect(screen.getByLabelText('Mortgage results')).toHaveTextContent('€633.40');
    field('Down payment (EUR)', '150001');
    expect(screen.getByRole('alert')).toHaveTextContent('Down payment cannot exceed');
  });

  it('applies a reverse purchase budget to the shared mortgage', () => {
    setup();
    field('Desired maximum mortgage payment / month (EUR)', '700');
    fireEvent.click(screen.getByRole('button', { name: 'Use this purchase price in the scenario' }));
    expect(screen.getByLabelText('Mortgage results')).toHaveTextContent('€700.00');
    expect(screen.getByLabelText('Purchase budget results')).toHaveTextContent('€700.00');
  });

  it('uses annual summaries by default and exposes a reconciled monthly schedule', async () => {
    setup();
    fireEvent.click(screen.getByText('View the repayment schedule'));
    const table = within(screen.getByRole('region', { name: 'Mortgage amortization table' })).getByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(26);
    fireEvent.change(screen.getByLabelText('Schedule view'), { target: { value: 'monthly' } });
    expect(within(table).getAllByRole('row')).toHaveLength(301);
    expect(within(table).getAllByRole('row').at(-1)).toHaveTextContent('€0.00');
    fireEvent.click(screen.getByRole('button', { name: 'Annual payments' }));
    expect(screen.getByRole('button', { name: 'Annual payments' })).toHaveAttribute('aria-pressed', 'true');
    await screen.findByTestId('calculator-chart');
  });

  it('allows lower-rate cases but marks negative resulting rates unavailable', () => {
    setup();
    field('Nominal annual interest rate (%)', '0');
    const table = within(screen.getByRole('region', { name: 'Interest rate scenario comparison' })).getByRole('table');
    expect(table).toHaveTextContent('Unavailable: The scenario rate must be between 0% and 100%.');
    expect(within(table).getAllByRole('row')).toHaveLength(6);
  });

  it('links to existing statistical context without converting observations into assumptions', () => {
    const explore = setup();
    fireEvent.click(screen.getByRole('button', { name: /Income definitions/ }));
    expect(explore).toHaveBeenCalledWith('median_equivalised_income', 'methodology');
    fireEvent.click(screen.getByRole('button', { name: /Housing-cost pressure/ }));
    expect(explore).toHaveBeenCalledWith('housing_cost_overburden', 'compare');
  });
});

describe('visible API consistency checks', () => {
  it('confirms matching results after the debounce', async () => {
    setup();
    expect(screen.getByText(/Checking the calculation API/)).toBeVisible();
    await screen.findByText('Browser and API calculations agree.');
    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('keeps explicitly labelled browser results when the API is unreachable', async () => {
    verify.mockRejectedValue(new Error('Connection refused'));
    setup();
    await screen.findByText(/API check unavailable/);
    expect(screen.getByLabelText('Mortgage results')).toHaveTextContent('€633.40');
    expect(screen.getByText('Connection refused')).toBeVisible();
  });

  it('surfaces calculation disagreements', async () => {
    verify.mockRejectedValue(new CalculationMismatchError());
    setup();
    await waitFor(() => expect(screen.getByText(/displayed browser results are unverified/)).toBeVisible());
  });
});
