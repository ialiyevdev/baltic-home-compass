import pytest

from pipelines.catalog import PipelineSettings, indicator_definitions
from pipelines.eurostat import parse_series, validate_period, validate_value
from pipelines.sync import query_url


def synthetic_monthly():
    # Invented, isolated values exercise negative rates and differing dimension order.
    codes = {"geo": ["EE", "LV", "LT"], "time": ["2020-01", "2020-02"],
             "coicop18": ["TOTAL"], "unit": ["I25", "RCH_A"], "freq": ["M"]}
    return {
        "class": "dataset", "id": list(codes), "size": [len(items) for items in codes.values()],
        "dimension": {name: {"category": {"index": items}} for name, items in codes.items()},
        "value": [100, -0.5, 101, 0, 102, 1, 103, 2, 104, -1, 105, 3],
        "status": {"0": "b"},
    }


def test_monthly_parser_distinguishes_index_and_annual_change():
    payload = synthetic_monthly()
    index = parse_series(payload, dimensions={"freq": "M", "coicop18": "TOTAL", "unit": "I25"}, frequency="M")
    rates = parse_series(payload, dimensions={"freq": "M", "coicop18": "TOTAL", "unit": "RCH_A"},
                         frequency="M", value_kind="rate")
    assert [row["value"] for row in index] == [100, 101, 104, 105, 102, 103]
    assert [row["value"] for row in rates] == [-0.5, 0, -1, 3, 1, 2]
    assert index[0]["status"] == "b"
    assert rates[0]["status"] is None


def test_annual_currency_earnings_keep_zero_and_break_flags():
    codes = {"ecase": ["P1_NCH_AW100"], "time": ["2023", "2024"], "currency": ["EUR"],
             "geo": ["EE", "LV", "LT"], "estruct": ["NET"], "freq": ["A"]}
    payload = {
        "class": "dataset", "id": list(codes), "size": [len(items) for items in codes.values()],
        "dimension": {name: {"category": {"index": items}} for name, items in codes.items()},
        "value": [0, 12000, 13000, 14000, 15000, 16000], "status": {"3": "b", "4": "b", "5": "b"},
    }
    dimensions = {"freq": "A", "currency": "EUR", "estruct": "NET", "ecase": "P1_NCH_AW100"}
    rows = parse_series(payload, dimensions=dimensions, frequency="A", value_kind="nonnegative")
    assert rows[0]["value"] == 0
    assert [row["status"] for row in rows if row["period"] == "2024"] == ["b", "b", "b"]
    assert all(row["dimensions"] == dimensions for row in rows)


@pytest.mark.parametrize("period,frequency", [
    ("0000", "A"), ("2020-01", "A"), ("2020-Q1", "M"), ("2020-13", "M"),
    ("2020-00", "M"), ("2020-1", "M"), ("9999", "A"), ("9999-01", "M"),
])
def test_frequency_dates_are_validated(period, frequency):
    with pytest.raises(ValueError, match="period"):
        validate_period(period, frequency)


@pytest.mark.parametrize("value", [-100, -101, float("nan"), float("inf"), True, "1", 10**400])
def test_impossible_rates_are_rejected(value):
    with pytest.raises(ValueError):
        validate_value(value, "rate", "Inflation")


def test_valid_deflation_zero_and_missing_are_preserved():
    assert validate_value(-99.9, "rate", "Inflation") == -99.9
    assert validate_value(0, "rate", "Inflation") == 0
    assert validate_value(None, "rate", "Inflation") is None
    assert validate_value(0, "nonnegative", "Earnings") == 0
    with pytest.raises(ValueError):
        validate_value(-1, "nonnegative", "Earnings")


@pytest.mark.parametrize("value,valid", [(0, True), (100, True), (-0.1, False), (100.1, False)])
def test_population_percentage_is_bounded(value, valid):
    if valid:
        assert validate_value(value, "percentage", "Overburden") == value
    else:
        with pytest.raises(ValueError, match="between 0 and 100"):
            validate_value(value, "percentage", "Overburden")


def test_shared_hicp_request_always_contains_both_units():
    settings = PipelineSettings(_env_file=None)
    definitions = indicator_definitions(settings)
    index, annual_change = definitions[2:4]
    url = query_url(settings, index)
    assert url == query_url(settings, annual_change)
    assert "unit=I25&unit=RCH_A" in url
    assert "coicop18=TOTAL" in url
    assert "sinceTimePeriod=2020-01" in url


def test_earnings_request_is_the_verified_case():
    settings = PipelineSettings(_env_file=None)
    definition = indicator_definitions(settings)[1]
    url = query_url(settings, definition)
    assert "currency=EUR" in url and "estruct=NET" in url and "ecase=P1_NCH_AW100" in url
    assert "freq=A" in url and "sinceTimePeriod=2020" in url
