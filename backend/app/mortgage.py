import math
from decimal import Decimal

from backend.app.mortgage_models import MortgageRequest


RATE_DENOMINATOR = 1_200_000_000
PERCENT_DENOMINATOR = 100_000_000
MAX_REVERSE_CENTS = 100_000_000_000_000


def _cents(value: float) -> int:
    return int(Decimal(str(value)) * 100)


def _micropercent(value: float) -> int:
    return int(Decimal(str(value)) * 1_000_000)


def _round_ratio(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


def _down_payment(price: int, request: MortgageRequest) -> int:
    if request.down_payment.mode == "amount":
        return _cents(request.down_payment.value)
    return _round_ratio(price * _micropercent(request.down_payment.value), PERCENT_DENOMINATOR)


def _annuity_factor(rate_micro: int, months: int) -> float:
    monthly_rate = (rate_micro / 1_000_000) / 1200
    return months if monthly_rate == 0 else -math.expm1(-months * math.log1p(monthly_rate)) / monthly_rate


def _amortize(principal: int, rate_micro: int, months: int) -> dict:
    if principal == 0:
        return {"monthly": 0, "interest": 0, "total": 0, "final": 0, "schedule": []}
    first_interest = _round_ratio(principal * rate_micro, RATE_DENOMINATOR)
    regular = max(math.floor(principal / _annuity_factor(rate_micro, months) + 0.5), first_interest)
    balance, cumulative, total = principal, 0, 0
    schedule = []
    for month in range(1, months + 1):
        interest = _round_ratio(balance * rate_micro, RATE_DENOMINATOR)
        payment = balance + interest if month == months else min(regular, balance + interest)
        repaid = payment - interest
        balance -= repaid
        cumulative += interest
        total += payment
        schedule.append({"month": month, "payment": payment, "principal": repaid,
                         "interest": interest, "balance": balance, "cumulative_interest": cumulative})
        if balance == 0:
            break
    return {"monthly": regular, "interest": cumulative, "total": total,
            "final": schedule[-1]["payment"], "schedule": schedule}


def _annualize(schedule: list[dict]) -> list[dict]:
    result = []
    for first in range(0, len(schedule), 12):
        group = schedule[first:first + 12]
        result.append({"year": first // 12 + 1,
                       **{field: sum(row[field] for row in group) for field in ("payment", "principal", "interest")},
                       "balance": group[-1]["balance"], "cumulative_interest": group[-1]["cumulative_interest"]})
    return result


def _euros(row: dict) -> dict:
    return {key: value if key in {"month", "year"} else value / 100 for key, value in row.items()}


def _reverse_budget(request: MortgageRequest, months: int, rate_micro: int) -> dict:
    result = {"status": "unavailable", "reason": None, "loan_principal": None, "property_price": None,
              "down_payment": None, "monthly_payment": None, "total_interest": None, "total_repayment": None}
    percent = _micropercent(request.down_payment.value) if request.down_payment.mode == "percent" else None
    if percent == PERCENT_DENOMINATOR:
        result["reason"] = "A 100% down payment does not identify a purchase price from a mortgage payment."
        return result
    supported = math.floor(_cents(request.desired_monthly_payment) * _annuity_factor(rate_micro, months))
    price = supported + _cents(request.down_payment.value) if percent is None else supported * PERCENT_DENOMINATOR // (PERCENT_DENOMINATOR - percent)
    if price > MAX_REVERSE_CENTS or supported > MAX_REVERSE_CENTS:
        result["reason"] = "The reverse scenario exceeds the supported EUR 1 trillion output range."
        return result
    down = _down_payment(price, request)
    principal = price - down
    loan = _amortize(principal, rate_micro, months)
    return {"status": "available", "reason": None, "loan_principal": principal / 100,
            "property_price": price / 100, "down_payment": down / 100,
            "monthly_payment": loan["monthly"] / 100, "total_interest": loan["interest"] / 100,
            "total_repayment": loan["total"] / 100}


def calculate_mortgage(request: MortgageRequest) -> dict:
    months = round(request.term_years * 12)
    price = _cents(request.property_price)
    down = _down_payment(price, request)
    principal = price - down
    rate_micro = _micropercent(request.annual_rate)
    loan = _amortize(principal, rate_micro, months)
    housing = loan["monthly"] + _cents(request.monthly_property_expenses)
    income = _cents(request.monthly_income) if request.monthly_income is not None else None

    def ratio(amount: int) -> float | None:
        return 100 * amount / income if income is not None and income > 0 else None

    mortgage_ratio, housing_ratio = ratio(loan["monthly"]), ratio(housing)
    scenarios = []
    for offset in [0, *request.rate_offsets]:
        scenario_micro = rate_micro + _micropercent(offset)
        if not 0 <= scenario_micro <= 100_000_000:
            scenarios.append({"offset": offset, "annual_rate": scenario_micro / 1_000_000,
                              "status": "unavailable", "reason": "The scenario rate must be between 0% and 100%.",
                              **{field: None for field in ("monthly_payment", "payment_difference", "total_interest",
                                  "total_interest_difference", "total_repayment", "total_repayment_difference",
                                  "mortgage_to_income", "ratio_difference")}})
            continue
        scenario = loan if offset == 0 else _amortize(principal, scenario_micro, months)
        scenario_ratio = ratio(scenario["monthly"])
        scenarios.append({"offset": offset, "annual_rate": scenario_micro / 1_000_000,
                          "status": "available", "reason": None, "monthly_payment": scenario["monthly"] / 100,
                          "payment_difference": (scenario["monthly"] - loan["monthly"]) / 100,
                          "total_interest": scenario["interest"] / 100,
                          "total_interest_difference": (scenario["interest"] - loan["interest"]) / 100,
                          "total_repayment": scenario["total"] / 100,
                          "total_repayment_difference": (scenario["total"] - loan["total"]) / 100,
                          "mortgage_to_income": scenario_ratio,
                          "ratio_difference": scenario_ratio - mortgage_ratio if scenario_ratio is not None and mortgage_ratio is not None else None})
    return {
        "spec_version": "1",
        "mortgage": {"property_price": price / 100, "down_payment": down / 100,
                     "loan_principal": principal / 100, "loan_to_value": 100 * principal / price if price > 0 else None,
                     "number_of_payments": len(loan["schedule"]), "monthly_payment": loan["monthly"] / 100,
                     "total_repayment": loan["total"] / 100, "total_interest": loan["interest"] / 100,
                     "initial_cash": (down + _cents(request.one_time_costs)) / 100,
                     "monthly_housing_outflow": housing / 100, "final_payment": loan["final"] / 100},
        "affordability": {"monthly_income": request.monthly_income, "mortgage_to_income": mortgage_ratio,
                          "debt_to_income": ratio(loan["monthly"] + _cents(request.monthly_debts)),
                          "housing_to_income": housing_ratio,
                          "remaining_income": (income - housing - _cents(request.monthly_debts) - _cents(request.monthly_living_expenses)) / 100 if income is not None else None,
                          "threshold": request.housing_threshold,
                          "threshold_exceeded": housing_ratio > request.housing_threshold if housing_ratio is not None else None},
        "reverse_budget": _reverse_budget(request, months, rate_micro),
        "rate_scenarios": scenarios,
        "schedule": [_euros(row) for row in loan["schedule"]],
        "annual_schedule": [_euros(row) for row in _annualize(loan["schedule"])],
    }
