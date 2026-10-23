import math
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


Money = Annotated[float, Field(strict=True, ge=0, le=1_000_000_000, allow_inf_nan=False)]
Percent = Annotated[float, Field(strict=True, ge=0, le=100, allow_inf_nan=False)]
Offset = Annotated[float, Field(strict=True, ge=-100, le=100, allow_inf_nan=False)]
Finite = Annotated[float, Field(allow_inf_nan=False)]


def check_precision(value: float, places: int) -> float:
    scaled = Decimal(str(value)) * 10 ** places
    if scaled != scaled.to_integral_value():
        raise ValueError(f"Use at most {places} decimal places.")
    return value


class DownPayment(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid")

    mode: Literal["amount", "percent"]
    value: Money

    @model_validator(mode="after")
    def validate_payment(self):
        if self.mode == "percent" and self.value > 100:
            raise ValueError("A percentage down payment must be between 0 and 100.")
        check_precision(self.value, 6 if self.mode == "percent" else 2)
        return self


class MortgageRequest(BaseModel):
    model_config = ConfigDict(strict=True, extra="forbid", json_schema_extra={"example": {
        "spec_version": "1", "country": "LV", "property_price": 150000,
        "down_payment": {"mode": "percent", "value": 20}, "annual_rate": 4,
        "term_years": 25, "monthly_property_expenses": 0, "one_time_costs": 0,
        "monthly_income": 2500, "monthly_debts": 0, "monthly_living_expenses": 0,
        "housing_threshold": 30, "desired_monthly_payment": 600, "rate_offsets": [-1, 1, 2, 3],
    }})

    spec_version: Literal["1"]
    country: Literal["EE", "LV", "LT"]
    property_price: Money
    down_payment: DownPayment
    annual_rate: Percent
    term_years: Annotated[float, Field(strict=True, gt=0, le=60, allow_inf_nan=False)]
    monthly_property_expenses: Money
    one_time_costs: Money
    monthly_income: Money | None
    monthly_debts: Money
    monthly_living_expenses: Money
    housing_threshold: Percent
    desired_monthly_payment: Money
    rate_offsets: Annotated[list[Offset], Field(max_length=8)]

    @field_validator("property_price", "monthly_property_expenses", "one_time_costs", "monthly_income", "monthly_debts", "monthly_living_expenses", "desired_monthly_payment")
    @classmethod
    def money_precision(cls, value):
        return check_precision(value, 2) if value is not None else None

    @field_validator("annual_rate", "housing_threshold")
    @classmethod
    def percentage_precision(cls, value):
        return check_precision(value, 6)

    @field_validator("term_years")
    @classmethod
    def whole_months(cls, value):
        months = value * 12
        if not 1 <= round(months) <= 720 or not math.isclose(months, round(months), rel_tol=0, abs_tol=1e-8):
            raise ValueError("The term must contain a whole number of months, from 1 to 720.")
        return value

    @field_validator("rate_offsets")
    @classmethod
    def distinct_offsets(cls, values):
        for value in values:
            check_precision(value, 6)
        if 0 in values:
            raise ValueError("The base rate is already included; omit zero.")
        if len(set(values)) != len(values):
            raise ValueError("Rate differences must be distinct.")
        return values

    @model_validator(mode="after")
    def down_payment_within_price(self):
        if self.down_payment.mode == "amount" and self.down_payment.value > self.property_price:
            raise ValueError("Down payment cannot exceed the purchase price.")
        return self


class MortgageSummary(BaseModel):
    property_price: Finite
    down_payment: Finite
    loan_principal: Finite
    loan_to_value: Finite | None
    number_of_payments: Annotated[int, Field(ge=0, le=720)]
    monthly_payment: Finite
    total_repayment: Finite
    total_interest: Finite
    initial_cash: Finite
    monthly_housing_outflow: Finite
    final_payment: Finite


class AffordabilityResult(BaseModel):
    monthly_income: Finite | None
    mortgage_to_income: Finite | None
    debt_to_income: Finite | None
    housing_to_income: Finite | None
    remaining_income: Finite | None
    threshold: Finite
    threshold_exceeded: bool | None


class ReverseBudget(BaseModel):
    status: Literal["available", "unavailable"]
    reason: str | None
    loan_principal: Finite | None
    property_price: Finite | None
    down_payment: Finite | None
    monthly_payment: Finite | None
    total_interest: Finite | None
    total_repayment: Finite | None


class RateScenario(BaseModel):
    offset: Finite
    annual_rate: Finite
    status: Literal["available", "unavailable"]
    reason: str | None
    monthly_payment: Finite | None
    payment_difference: Finite | None
    total_interest: Finite | None
    total_interest_difference: Finite | None
    total_repayment: Finite | None
    total_repayment_difference: Finite | None
    mortgage_to_income: Finite | None
    ratio_difference: Finite | None


class ScheduleRow(BaseModel):
    month: Annotated[int, Field(ge=1, le=720)]
    payment: Finite
    principal: Finite
    interest: Finite
    balance: Finite
    cumulative_interest: Finite


class AnnualScheduleRow(BaseModel):
    year: Annotated[int, Field(ge=1, le=60)]
    payment: Finite
    principal: Finite
    interest: Finite
    balance: Finite
    cumulative_interest: Finite


class CalculatorResult(BaseModel):
    spec_version: Literal["1"]
    mortgage: MortgageSummary
    affordability: AffordabilityResult
    reverse_budget: ReverseBudget
    rate_scenarios: list[RateScenario]
    schedule: list[ScheduleRow]
    annual_schedule: list[AnnualScheduleRow]
