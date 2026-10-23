# Mortgage calculations (specification 1)

Calculations are stateless educational scenarios in EUR. Country selects statistical context only; it never changes formulas, costs or borrowing limits. No entered financial values are saved. API mode sends the scenario in a POST body to the configured local FastAPI server; static mode calculates entirely in the browser.

## Inputs

Both implementations accept the same JSON object. Defaults belong to the form, not the engine.

```json
{
  "spec_version": "1",
  "country": "LV",
  "property_price": 150000,
  "down_payment": {"mode": "percent", "value": 20},
  "annual_rate": 4,
  "term_years": 25,
  "monthly_property_expenses": 0,
  "one_time_costs": 0,
  "monthly_income": null,
  "monthly_debts": 0,
  "monthly_living_expenses": 0,
  "housing_threshold": 30,
  "desired_monthly_payment": 600,
  "rate_offsets": [-1, 1, 2, 3]
}
```

These are hypothetical example inputs, not country averages. Amounts must be finite, nonnegative, at most EUR 1 billion and have at most two decimal places. Income may be null. Rates and percentages allow six decimal places. The nominal annual rate is between 0 and 100%; down payment and the personal housing threshold are between 0 and 100%. Fixed down payment cannot exceed purchase price. Terms must represent a whole number of months, from 1 to 720 (60 years). These are calculation precision and workload limits, not lending rules. Up to eight distinct nonzero rate offsets, between -100 and +100 percentage points, supplement the base case. An offset producing an invalid rate is explicitly unavailable; it does not invalidate the base case. Reverse results above EUR 1 trillion are unavailable because they exceed the supported output range.

## Payment and rounding

Let `P = price - down payment`, `r = annual_rate / 1200`, and `n = term_years * 12`. A percentage down payment is calculated from the purchase price and rounded to cents, half up.

For `r > 0`, the regular payment is `M = P*r / (1 - (1+r)^(-n))`. Implementations use `-expm1(-n*log1p(r))` for the denominator to avoid cancellation at low rates. For `r = 0`, `M = P/n`. The annual rate is nominal, excludes fees, and remains constant for the entire scenario. It is neither APRC nor an effective annual rate. Real variable-rate mortgages can behave differently.

Amounts in the schedule are integer cents. The regular payment is rounded half up to cents. The interest in each month is rounded half up from `balance_cents * annual_rate_micropercent / 1200000000`; integer arithmetic avoids binary half-cent differences. Principal repaid is payment minus interest. Payment never exceeds balance plus interest. The last contractual month pays the remaining balance plus interest, so it can differ from the regular payment. The balance is exactly zero at payoff; an early payoff ends the schedule. A zero principal has no schedule and zero mortgage payments.

Total repayment and total interest sum the reconciled schedule rather than multiplying the rounded regular payment by the term. At extreme rates and long terms, cent rounding can prevent principal reduction during regular payments and make the final payment substantially larger; it is always shown explicitly. The regular payment is at least the first month's rounded interest, preventing numeric cancellation from creating negative amortization. Annual rows sum each group of at most twelve monthly rows and retain its last balance and cumulative interest. Initial cash is down payment plus entered one-time costs. Monthly housing outflow is regular principal-and-interest payment plus entered monthly property expenses. LTV is principal divided by price, times 100, and is unavailable for a zero price.

## Household and rate scenarios

Mortgage-to-income is `100*M/income`; debt-to-income is `100*(M + existing debt payments)/income`; housing-to-income is `100*(M + property expenses)/income`. Ratios and the threshold comparison are unavailable when income is missing or zero. Remaining income is income minus mortgage, property expenses, debts and living expenses; it remains meaningful for an entered zero income. Threshold exceedance compares total housing outflow to the user's threshold, not a bank approval rule. Costs are included only when entered.

Each rate scenario recalculates the same initial principal and full original term at its own constant nominal rate. Differences use the base case's reconciled totals and regular payment. Payment-to-income uses the mortgage payment only. These cases are not future-rate forecasts or mid-loan repricing simulations.

## Reverse purchase budget

For a desired monthly principal-and-interest payment `M`, supported principal is `M*(1-(1+r)^(-n))/r`, or `M*n` at zero interest. Round principal down to cents. For a fixed down payment `D`, price is `P+D`. For percentage `q`, price is `P/(1-q)` rounded down to cents; recalculate its cent-rounded down payment and actual principal before running the forward schedule. This keeps the resulting regular payment at or below the desired payment. A 100% down payment does not identify a price from a mortgage payment, so that reverse scenario is unavailable. Total interest comes from the same forward engine.

## Shared result contract

`spec_version` is `"1"`. `mortgage` contains `property_price`, `down_payment`, `loan_principal`, `loan_to_value`, `number_of_payments`, `monthly_payment`, `total_repayment`, `total_interest`, `initial_cash`, `monthly_housing_outflow` and `final_payment`.

`affordability` contains `monthly_income`, `mortgage_to_income`, `debt_to_income`, `housing_to_income`, `remaining_income`, `threshold` and `threshold_exceeded`.

`reverse_budget` contains `status` (`available` or `unavailable`), `reason`, `loan_principal`, `property_price`, `down_payment`, `monthly_payment`, `total_interest` and `total_repayment`. Unavailable numeric fields are null.

`rate_scenarios` contains the base case followed by requested offsets, each with `offset`, `annual_rate`, `status`, `reason`, `monthly_payment`, `payment_difference`, `total_interest`, `total_interest_difference`, `total_repayment`, `total_repayment_difference`, `mortgage_to_income` and `ratio_difference`. Unavailable numeric results are null. `schedule` rows contain `month`, `payment`, `principal`, `interest`, `balance`, `cumulative_interest`. `annual_schedule` uses `year` instead of `month`.

Python owns the API implementation; TypeScript implements this same specification for a standalone static demo. Shared reference cases and cross-language tests check cent-level results and full schedules. In API mode the UI checks the returned result against the local calculation and exposes any disagreement or connection failure explicitly. It never silently switches calculation definitions.

## Official benchmark context

ECB series `MIR.M.<EE/LV/LT>.B.A2C.AM.R.A.2250.EUR.N` is a national new-business house-purchase borrowing-cost measure using AAR/NDER, not a personal offer or a directly interchangeable nominal rate. The calculator displays its observation month, retrieval time, flags and source separately. It does not copy it into the nominal-rate input or infer fees, property prices or household income. The [ECB interest-rate statistics manual, section 4.2](https://www.ecb.europa.eu/pub/pdf/other/manualonmfiinterestratestatistics_201701.en.pdf) explains the annualisation. Missing data leaves manual inputs available.
