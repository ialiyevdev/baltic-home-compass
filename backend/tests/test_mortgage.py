import json
from copy import deepcopy
from decimal import Decimal, ROUND_HALF_UP, localcontext
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.app.mortgage import calculate_mortgage
from backend.app.mortgage_models import CalculatorResult, MortgageRequest


REFERENCES = json.loads((Path(__file__).resolve().parents[2] / "data/fixtures/mortgage-cases.json").read_text(encoding="utf-8"))["cases"]
EXAMPLE = REFERENCES[0]["input"]


def calculate(**changes):
    return calculate_mortgage(MortgageRequest.model_validate(EXAMPLE | changes))


def cents(value):
    return int(Decimal(str(value)) * 100)


@pytest.mark.parametrize("case", REFERENCES, ids=lambda case: case["name"])
def test_shared_independent_decimal_reference_cases(case):
    request = MortgageRequest.model_validate(case["input"])
    result = calculate_mortgage(request)
    CalculatorResult.model_validate(result)
    for field, expected in case["expected"].items():
        if field == "first_payment":
            assert (result["schedule"][0] if result["schedule"] else None) == expected
        elif field == "last_payment":
            assert (result["schedule"][-1] if result["schedule"] else None) == expected
        else:
            assert result["mortgage"][field] == expected
    schedule, annual, mortgage = result["schedule"], result["annual_schedule"], result["mortgage"]
    assert all(row["balance"] >= 0 and row["principal"] >= 0 for row in schedule)
    assert (schedule[-1]["balance"] if schedule else 0) == 0
    assert sum(cents(row["principal"]) for row in schedule) == cents(mortgage["loan_principal"])
    assert sum(cents(row["interest"]) for row in schedule) == cents(mortgage["total_interest"])
    assert sum(cents(row["payment"]) for row in annual) == cents(mortgage["total_repayment"])
    assert cents(mortgage["total_repayment"]) == cents(mortgage["loan_principal"]) + cents(mortgage["total_interest"])
    assert schedule == [] or schedule[-1]["cumulative_interest"] == mortgage["total_interest"]
    json.dumps(result, allow_nan=False)


def decimal_schedule(principal, annual_rate, months):
    with localcontext() as context:
        context.prec = 75
        cent = Decimal("0.01")
        balance = Decimal(str(principal))
        rate = Decimal(str(annual_rate)) / 1200
        payment = (balance / months if rate == 0 else balance * rate / (1 - (1 + rate) ** -months)).quantize(cent, rounding=ROUND_HALF_UP)
        rows, cumulative = [], Decimal(0)
        for month in range(1, months + 1):
            interest = (balance * rate).quantize(cent, rounding=ROUND_HALF_UP)
            actual = balance + interest if month == months else min(payment, balance + interest)
            principal_paid = actual - interest
            balance -= principal_paid
            cumulative += interest
            rows.append({"month": month, "payment": float(actual), "principal": float(principal_paid),
                         "interest": float(interest), "balance": float(balance), "cumulative_interest": float(cumulative)})
            if balance == 0:
                break
        return rows


@pytest.mark.parametrize("principal,rate,months", [
    (100_000, 4, 360), (137_451.29, 3.217891, 177), (1, 6, 12),
    (100, 100, 720), (800_000_000, 0.000001, 720),
])
def test_every_payment_matches_a_separate_high_precision_decimal_schedule(principal, rate, months):
    result = calculate(property_price=principal, down_payment={"mode": "amount", "value": 0},
                       annual_rate=rate, term_years=months / 12)
    assert result["schedule"] == decimal_schedule(principal, rate, months)


@pytest.mark.parametrize("field,value", [
    ("property_price", -1), ("property_price", 1_000_000_000.01),
    ("property_price", 1.001), ("property_price", 1e-9), ("property_price", True),
    ("property_price", "150000"), ("property_price", float("inf")), ("property_price", float("nan")),
    ("annual_rate", -0.01), ("annual_rate", 100.000001), ("annual_rate", 0.0000001),
    ("annual_rate", True), ("annual_rate", "4"), ("annual_rate", float("nan")),
    ("term_years", 0), ("term_years", 60.1), ("term_years", 0.1), ("term_years", True),
    ("monthly_income", -1), ("monthly_income", True), ("monthly_income", "2000"),
    ("monthly_debts", 0.001), ("monthly_living_expenses", -1), ("one_time_costs", -1),
    ("monthly_property_expenses", -1), ("desired_monthly_payment", -1),
    ("housing_threshold", 101), ("housing_threshold", 30.0000001),
    ("country", "FI"), ("spec_version", "2"), ("unexpected", 1),
    ("rate_offsets", [0]), ("rate_offsets", [1, 1]), ("rate_offsets", [True]),
    ("rate_offsets", [0.0000001]), ("rate_offsets", [101]), ("rate_offsets", [-101]),
    ("rate_offsets", [1, 2, 3, 4, 5, 6, 7, 8, 9]),
])
def test_invalid_requests_are_rejected(field, value):
    with pytest.raises(ValidationError):
        MortgageRequest.model_validate(EXAMPLE | {field: value})


@pytest.mark.parametrize("down", [
    {"mode": "percent", "value": 100.01}, {"mode": "percent", "value": 10.0000001},
    {"mode": "amount", "value": 150000.01}, {"mode": "amount", "value": 10.001},
    {"mode": "amount", "value": True}, {"mode": "other", "value": 10},
    {"mode": "amount", "value": 10, "other": 0},
])
def test_invalid_down_payment_is_rejected(down):
    with pytest.raises(ValidationError):
        MortgageRequest.model_validate(EXAMPLE | {"down_payment": down})


def test_all_request_fields_are_required_including_nullable_income():
    for field in EXAMPLE:
        incomplete = deepcopy(EXAMPLE)
        del incomplete[field]
        with pytest.raises(ValidationError):
            MortgageRequest.model_validate(incomplete)


def test_zero_interest_final_cent_and_early_payoff_are_reconciled():
    result = calculate(property_price=100, down_payment={"mode": "amount", "value": 0},
                       annual_rate=0, term_years=0.25)
    assert [row["payment"] for row in result["schedule"]] == [33.33, 33.33, 33.34]
    assert result["mortgage"]["total_interest"] == 0
    early = calculate(property_price=0.06, down_payment={"mode": "amount", "value": 0},
                      annual_rate=0, term_years=1)
    assert early["mortgage"]["number_of_payments"] == 6
    assert early["annual_schedule"][0]["principal"] == 0.06


def test_one_month_term_and_partial_annual_summary():
    result = calculate(property_price=15000, down_payment={"mode": "amount", "value": 0},
                       annual_rate=5, term_years=1 / 12)
    assert result["mortgage"]["monthly_payment"] == 15062.5
    assert result["mortgage"]["total_interest"] == 62.5
    assert result["annual_schedule"] == [{"year": 1, "payment": 15062.5, "principal": 15000,
                                          "interest": 62.5, "balance": 0, "cumulative_interest": 62.5}]


def test_percentage_deposit_rounds_half_cents_up():
    result = calculate(property_price=0.03, down_payment={"mode": "percent", "value": 50})
    assert result["mortgage"]["down_payment"] == 0.02
    assert result["mortgage"]["loan_principal"] == 0.01


def test_missing_and_zero_income_remain_different():
    missing = calculate()["affordability"]
    assert all(missing[field] is None for field in ("monthly_income", "remaining_income", "mortgage_to_income", "threshold_exceeded"))
    zero = calculate(monthly_income=0, monthly_debts=100)["affordability"]
    assert zero["remaining_income"] == -733.4
    assert zero["mortgage_to_income"] is None
    assert zero["debt_to_income"] is None
    assert zero["housing_to_income"] is None
    assert zero["threshold_exceeded"] is None


def test_household_ratios_use_distinct_costs_and_personal_housing_threshold():
    result = calculate(monthly_income=1000, monthly_debts=1200, monthly_property_expenses=100,
                       monthly_living_expenses=500, one_time_costs=2500)
    budget = result["affordability"]
    assert budget["mortgage_to_income"] == pytest.approx(63.34)
    assert budget["debt_to_income"] == pytest.approx(183.34)
    assert budget["housing_to_income"] == pytest.approx(73.34)
    assert budget["remaining_income"] == -1433.4
    assert budget["threshold_exceeded"] is True
    assert result["mortgage"]["initial_cash"] == 32500
    assert calculate(monthly_income=2000, housing_threshold=100)["affordability"]["threshold_exceeded"] is False


def test_full_cash_purchase_has_no_mortgage_but_retains_entered_expenses():
    result = calculate(down_payment={"mode": "percent", "value": 100}, monthly_property_expenses=200,
                       monthly_income=1000, one_time_costs=500)
    assert result["schedule"] == result["annual_schedule"] == []
    assert result["mortgage"]["monthly_payment"] == 0
    assert result["mortgage"]["monthly_housing_outflow"] == 200
    assert result["mortgage"]["initial_cash"] == 150500
    assert result["mortgage"]["loan_to_value"] == 0
    assert result["affordability"]["housing_to_income"] == 20
    assert result["reverse_budget"]["status"] == "unavailable"
    assert calculate(property_price=0)["mortgage"]["loan_to_value"] is None


@pytest.mark.parametrize("mode,value", [("amount", 30000), ("percent", 20), ("percent", 99)])
def test_reverse_budget_is_consistent_with_forward_schedule(mode, value):
    changes = {"down_payment": {"mode": mode, "value": value}, "desired_monthly_payment": 700}
    reverse = calculate(**changes)["reverse_budget"]
    assert reverse["status"] == "available"
    forward = calculate(**(changes | {"property_price": reverse["property_price"]})) if reverse["property_price"] <= 1e9 else None
    if forward:
        for field in ("down_payment", "loan_principal", "monthly_payment", "total_interest", "total_repayment"):
            assert forward["mortgage"][field] == reverse[field]
    assert reverse["monthly_payment"] <= 700


def test_zero_rate_reverse_fixed_and_percent_deposits_have_independent_expected_values():
    common = {"annual_rate": 0, "term_years": 10, "desired_monthly_payment": 500}
    fixed = calculate(**common, down_payment={"mode": "amount", "value": 10000})["reverse_budget"]
    assert (fixed["loan_principal"], fixed["property_price"], fixed["down_payment"]) == (60000, 70000, 10000)
    percentage = calculate(**common, down_payment={"mode": "percent", "value": 20})["reverse_budget"]
    assert (percentage["loan_principal"], percentage["property_price"], percentage["down_payment"]) == (60000, 75000, 15000)
    assert percentage["total_interest"] == 0


def test_reverse_excessive_output_is_unavailable_without_losing_forward_result():
    result = calculate(down_payment={"mode": "percent", "value": 99.999999}, desired_monthly_payment=1e9)
    reverse = result["reverse_budget"]
    assert reverse["status"] == "unavailable"
    assert "trillion" in reverse["reason"]
    assert all(value is None for field, value in reverse.items() if field not in {"status", "reason"})
    assert result["mortgage"]["loan_principal"] == 0


def test_rate_scenarios_keep_invalid_offsets_explicit_and_reconcile_differences():
    result = calculate(annual_rate=0, rate_offsets=[-1, 1, 100], monthly_income=2000)
    base, invalid, higher, maximum = result["rate_scenarios"]
    assert base["offset"] == 0 and base["payment_difference"] == 0
    assert invalid["status"] == "unavailable" and invalid["annual_rate"] == -1
    assert invalid["monthly_payment"] is None
    assert higher["payment_difference"] == round(higher["monthly_payment"] - base["monthly_payment"], 2)
    assert higher["total_interest_difference"] == round(higher["total_interest"] - base["total_interest"], 2)
    assert higher["ratio_difference"] == pytest.approx(higher["mortgage_to_income"] - base["mortgage_to_income"])
    assert maximum["status"] == "available"


def test_country_selection_does_not_add_unverified_costs_or_limits():
    original = calculate()
    assert calculate(country="EE") == original
    assert calculate(country="LT") == original
