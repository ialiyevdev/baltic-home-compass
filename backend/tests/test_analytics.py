from copy import deepcopy
import os

import pytest

from backend.app.analytics import build_comparison, list_metrics


COUNTRIES = ("EE", "LV", "LT")


def source(code, frequency, dimensions, kind="index"):
    return {
        "code": code, "dataset_code": "synthetic_test_only", "name": code,
        "description": "Synthetic analytics test only", "unit": "Test unit", "frequency": frequency,
        "dimensions": {"freq": frequency, **dimensions}, "comparison_kind": kind,
        "publisher": "Test only", "source_url": "https://example.org/test-only",
    }


def bundle():
    return {
        "countries": [{"code": country, "name": country} for country in COUNTRIES],
        "indicators": [
            source("house_price_index", "Q", {"purchase": "TOTAL", "unit": "I15_Q"}),
            source("annual_net_earnings", "A", {"currency": "EUR", "estruct": "NET", "ecase": "P1_NCH_AW100"}),
            source("hicp_index", "M", {"unit": "I25", "coicop18": "TOTAL"}),
            source("hicp_annual_change", "M", {"unit": "RCH_A", "coicop18": "TOTAL"}, "percentage_points"),
        ],
        "observations": [],
    }


def add(data, code, period, value, country=None, status=None):
    definition = next(item for item in data["indicators"] if item["code"] == code)
    for selected in [country] if country else COUNTRIES:
        data["observations"].append({
            "country": selected, "indicator": code, "period": period, "value": value, "status": status,
            "dimensions": definition["dimensions"].copy(), "source_url": definition["source_url"],
            "retrieved_at": "2026-01-01T00:00:00Z",
        })


def series(result, component, country="EE"):
    return next(item for item in result["series"] if item["country"] == country and item["component"] == component)


def point(result, component, period, country="EE"):
    return next(item for item in series(result, component, country)["points"] if item["period"] == period)


def earnings_year(data, year, hpi, earnings, status=None):
    for quarter in range(1, 5):
        add(data, "house_price_index", f"{year}-Q{quarter}", hpi)
    add(data, "annual_net_earnings", str(year), earnings, status=status)


def hicp_quarter(data, year, quarter, values):
    for month, value in zip(range((quarter - 1) * 3 + 1, quarter * 3 + 1), values, strict=True):
        add(data, "hicp_index", f"{year}-{month:02d}", value)


def test_house_prices_and_earnings_use_four_quarter_means_and_own_country_bases():
    data = bundle()
    values = {
        "EE": ([80, 90, 110, 120], [100, 110, 120, 154], 1000, 1100),
        "LV": ([160, 180, 220, 240], [240, 260, 300, 352], 2000, 2500),
        "LT": ([40, 45, 55, 60], [55, 60, 65, 70], 500, 625),
    }
    for country, (first, last, first_income, last_income) in values.items():
        for quarter, value in enumerate(first, 1):
            add(data, "house_price_index", f"2020-Q{quarter}", value, country)
        for quarter, value in enumerate(last, 1):
            add(data, "house_price_index", f"2021-Q{quarter}", value, country)
        add(data, "annual_net_earnings", "2020", first_income, country)
        add(data, "annual_net_earnings", "2021", last_income, country)
    unchanged = deepcopy(data)
    result = build_comparison(data, "housing_earnings")
    assert result["status"] == "available"
    assert result["frequency"] == "A"
    assert point(result, "hpi", "2021")["value"] == pytest.approx(121)
    assert point(result, "hpi", "2021", "LV")["change"] == pytest.approx(44)
    assert point(result, "hpi", "2021", "LT")["change"] == pytest.approx(25)
    assert point(result, "earnings", "2021")["change"] == pytest.approx(10)
    ranks = {row["country"]: row["rank"] for row in result["rankings"] if row["component"] == "earnings"}
    assert ranks == {"LV": 1, "LT": 1, "EE": 2}
    assert len(point(result, "hpi", "2021")["source_periods"]) == 4
    assert data == unchanged


def test_housing_inflation_adjustment_uses_three_month_mean_not_rates():
    data = bundle()
    add(data, "house_price_index", "2020-Q1", 100)
    add(data, "house_price_index", "2020-Q2", 121, status="p")
    hicp_quarter(data, 2020, 1, [90, 100, 110])
    hicp_quarter(data, 2020, 2, [100, 110, 120])
    add(data, "hicp_annual_change", "2020-04", 999)
    result = build_comparison(data, "housing_inflation")
    assert point(result, "nominal_hpi", "2020-Q2")["value"] == pytest.approx(121)
    assert point(result, "hicp", "2020-Q2")["value"] == pytest.approx(110)
    adjusted = point(result, "real_hpi", "2020-Q2")
    assert adjusted["value"] == pytest.approx(110)
    assert adjusted["change"] == pytest.approx(10)
    assert adjusted["flags"] == ["p"]
    assert adjusted["source_periods"] == ["2020-04", "2020-05", "2020-06", "2020-Q2"]


def test_real_earnings_uses_twelve_month_hicp_and_returns_an_index():
    data = bundle()
    for year, income, hicp in [(2020, 1000, 100), (2021, 1210, 110)]:
        add(data, "annual_net_earnings", str(year), income)
        for month in range(1, 13):
            add(data, "hicp_index", f"{year}-{month:02d}", hicp)
    result = build_comparison(data, "real_earnings")
    assert point(result, "nominal_earnings", "2021")["value"] == pytest.approx(121)
    assert point(result, "real_earnings", "2021")["value"] == pytest.approx(110)
    assert "Index" in series(result, "real_earnings")["unit"]
    assert "not a consumer-euro" in result["method"]


@pytest.mark.parametrize("missing_source", ["house_price_index", "hicp_index"])
def test_partial_aggregation_is_missing_not_a_shorter_average(missing_source):
    data = bundle()
    for year in (2020, 2021):
        earnings_year(data, year, 100 + 10 * (year - 2020), 1000)
        for month in range(1, 13):
            add(data, "hicp_index", f"{year}-{month:02d}", 100)
    remove = "2021-Q4" if missing_source == "house_price_index" else "2021-12"
    data["observations"] = [row for row in data["observations"] if not (row["indicator"] == missing_source and row["period"] == remove)]
    metric = "housing_earnings" if missing_source == "house_price_index" else "real_earnings"
    component = "hpi" if missing_source == "house_price_index" else "real_earnings"
    result = build_comparison(data, metric, base_period="2020")
    assert point(result, component, "2021")["value"] is None
    assert result["end_period"] == "2020"
    assert "2021" not in result["rankings_by_period"]
    assert any("Requires all" in item["reason"] for item in result["exclusions"])


def test_default_earnings_base_starts_at_the_latest_break():
    data = bundle()
    earnings_year(data, 2023, 100, 1000)
    earnings_year(data, 2024, 110, 2000, status="b")
    earnings_year(data, 2025, 121, 2200)
    result = build_comparison(data, "housing_earnings")
    assert result["base_period"] == "2024"
    assert point(result, "earnings", "2025")["change"] == pytest.approx(10)
    assert point(result, "earnings", "2024")["flags"] == ["b"]
    assert point(result, "earnings", "2023")["value"] is None
    earlier = build_comparison(data, "housing_earnings", base_period="2023")
    assert point(earlier, "earnings", "2024")["value"] is None
    assert point(earlier, "earnings", "2025")["value"] is None
    assert earlier["end_period"] == "2023"
    assert earlier["status"] == "unavailable"


def test_break_inside_an_aggregate_invalidates_the_aggregate():
    data = bundle()
    earnings_year(data, 2020, 100, 1000)
    earnings_year(data, 2021, 110, 1100)
    for row in data["observations"]:
        if row["indicator"] == "house_price_index" and row["period"] == "2021-Q2":
            row["status"] = "b"
    result = build_comparison(data, "housing_earnings", base_period="2020")
    assert point(result, "hpi", "2021")["value"] is None
    assert "break" in point(result, "hpi", "2021")["reason"]


def test_a_missing_interior_period_is_a_gap_and_endpoints_remain_valid():
    data = bundle()
    add(data, "house_price_index", "2020-Q1", 100)
    add(data, "house_price_index", "2020-Q3", 120)
    result = build_comparison(data, "indicator_change", indicator="house_price_index")
    gap = point(result, "house_price_index", "2020-Q2")
    assert gap["value"] is None
    assert gap["change"] is None
    assert point(result, "house_price_index", "2020-Q3")["change"] == pytest.approx(20)
    assert result["end_period"] == "2020-Q3"
    assert "2020-Q2" not in result["rankings_by_period"]


def test_ranking_uses_the_latest_common_endpoint_not_each_countrys_latest():
    data = bundle()
    for period, value in [("2020-Q1", 100), ("2020-Q2", 110)]:
        add(data, "house_price_index", period, value)
    add(data, "house_price_index", "2020-Q3", 130, "EE")
    result = build_comparison(data, "indicator_change", indicator="house_price_index")
    assert result["end_period"] == "2020-Q2"
    assert all(row["change"] == pytest.approx(10) for row in result["rankings"])
    assert "2020-Q3" not in result["rankings_by_period"]
    subset = build_comparison(data, "indicator_change", indicator="house_price_index", countries=["EE"])
    assert subset["end_period"] == "2020-Q3"


def test_rates_are_percentage_point_changes_even_when_negative():
    data = bundle()
    add(data, "hicp_annual_change", "2020-01", -1)
    add(data, "hicp_annual_change", "2020-02", -2)
    result = build_comparison(data, "indicator_change", indicator="hicp_annual_change")
    assert point(result, "hicp_annual_change", "2020-01")["value"] == 0
    assert point(result, "hicp_annual_change", "2020-02")["value"] == -1
    assert result["rankings"][0]["unit"] == "pp"
    assert result["rankings"][0]["change"] == -1


def test_zero_base_is_not_divided_and_null_source_is_preserved():
    data = bundle()
    add(data, "annual_net_earnings", "2020", 0)
    add(data, "annual_net_earnings", "2021", 1000)
    result = build_comparison(data, "indicator_change", indicator="annual_net_earnings", base_period="2020")
    assert result["status"] == "unavailable"
    assert result["rankings"] == []


@pytest.mark.parametrize("mutate", ["missing", "frequency", "definition", "unknown_kind"])
def test_incompatible_or_missing_metadata_returns_unavailable(mutate):
    data = bundle()
    add(data, "house_price_index", "2020-Q1", 100)
    if mutate == "missing":
        data["indicators"] = []
    elif mutate == "frequency":
        data["indicators"][0]["frequency"] = "Z"
    elif mutate == "definition":
        data["indicators"][0]["dimensions"]["purchase"] = "DW_NEW"
    else:
        data["indicators"][0]["comparison_kind"] = "unknown"
    metric = "indicator_change" if mutate == "unknown_kind" else "housing_inflation"
    result = build_comparison(data, metric, indicator="house_price_index" if metric == "indicator_change" else None)
    assert result["status"] == "unavailable"


@pytest.mark.parametrize("arguments", [
    {"countries": []}, {"countries": ["US"]}, {"countries": ["LV", "LV"]},
    {"start": "2020-01"}, {"start": "2021-Q1", "end": "2020-Q1"},
    {"start": "2021-Q1", "base_period": "2020-Q1"},
])
def test_invalid_comparison_options_are_rejected(arguments):
    with pytest.raises(ValueError):
        build_comparison(bundle(), "housing_inflation", **arguments)


def test_duplicate_source_rows_are_rejected():
    data = bundle()
    add(data, "house_price_index", "2020-Q1", 100)
    add(data, "house_price_index", "2020-Q1", 101)
    with pytest.raises(ValueError, match="Duplicate"):
        build_comparison(data, "indicator_change", indicator="house_price_index")


@pytest.mark.parametrize("value", [True, float("nan"), float("inf"), 10 ** 1000])
def test_invalid_numeric_observations_are_rejected(value):
    data = bundle()
    add(data, "house_price_index", "2020-Q1", value)
    with pytest.raises(ValueError, match="finite numeric"):
        build_comparison(data, "indicator_change", indicator="house_price_index")


def test_finite_large_equal_indices_can_be_normalized_without_intermediate_overflow():
    data = bundle()
    add(data, "house_price_index", "2020-Q1", 1e308)
    add(data, "house_price_index", "2020-Q2", 1e308)
    result = build_comparison(data, "indicator_change", indicator="house_price_index")
    assert point(result, "house_price_index", "2020-Q2")["value"] == 100


def test_catalog_exposes_only_bases_with_a_later_compatible_endpoint():
    data = bundle()
    for period, value in [("2020-Q1", 100), ("2020-Q2", 110), ("2020-Q3", 120)]:
        add(data, "house_price_index", period, value)
    metrics = list_metrics(data)
    item = next(item for item in metrics if item["id"] == "indicator_change:house_price_index")
    assert item["base_periods"] == ["2020-Q1", "2020-Q2"]
    assert item["default_base_period"] == "2020-Q1"
    assert item["components"] == [{"id": "house_price_index", "label": "house_price_index"}]


@pytest.fixture
def sql_database(monkeypatch):
    from backend.app.config import get_settings
    from backend.app.db import connect
    from database.migrate import migrate

    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL for analytics SQL view integration checks")
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    migrate()
    try:
        with connect() as connection:
            try:
                yield connection
            finally:
                connection.rollback()
    finally:
        get_settings.cache_clear()


def sql_rows(connection, code, frequency, rows):
    dataset = "analytics_test_" + frequency.lower()
    connection.execute(
        "INSERT INTO datasets (code, publisher, name, source_url, frequency, attribution) "
        "VALUES (%s, 'Synthetic test only', 'Synthetic test only', 'https://example.org/', %s, 'Test only') "
        "ON CONFLICT DO NOTHING", (dataset, frequency),
    )
    connection.execute(
        "INSERT INTO indicators (code, dataset_code, name, description, unit, frequency) "
        "VALUES (%s, %s, 'Test only', 'Synthetic test only', 'Test unit', %s) ON CONFLICT DO NOTHING",
        (code, dataset, frequency),
    )
    run = connection.execute(
        "INSERT INTO ingestion_runs (dataset_code, indicator_code, status, finished_at, source_url) "
        "VALUES (%s, %s, 'success', now(), 'https://example.org/') RETURNING id", (dataset, code),
    ).fetchone()["id"]
    for period, value, flag in rows:
        connection.execute(
            "INSERT INTO observations (country_code, indicator_code, period, value, status, source_url, ingestion_run_id) "
            "VALUES ('EE', %s, %s, %s, %s, 'https://example.org/', %s)", (code, period, value, flag, run),
        )


@pytest.mark.integration
def test_sql_annual_hpi_requires_four_observations_and_retains_flags(sql_database):
    sql_rows(sql_database, "house_price_index", "Q", [
        ("1980-Q1", 80, "b"), ("1980-Q2", 90, None), ("1980-Q3", 110, None), ("1980-Q4", 120, "p"),
        ("1981-Q1", 100, None), ("1981-Q2", None, ":"), ("1981-Q3", 110, None), ("1981-Q4", 120, None),
    ])
    result = sql_database.execute(
        "SELECT * FROM v_house_price_annual WHERE country_code='EE' AND period IN ('1980','1981') ORDER BY period"
    ).fetchall()
    assert float(result[0]["value"]) == 100
    assert result[0]["complete"] is True
    assert result[0]["component_count"] == 4
    assert set(result[0]["source_flags"]) == {"b", "p"}
    assert result[1]["value"] is None
    assert result[1]["component_count"] == 3
    assert result[1]["complete"] is False


@pytest.mark.integration
def test_sql_hicp_means_require_complete_quarters_and_years(sql_database):
    rows = [(f"1980-{month:02d}", 90 + 2 * (month - 1), None) for month in range(1, 13)]
    rows += [(f"1981-{month:02d}", 120, None) for month in range(1, 13) if month != 5]
    sql_rows(sql_database, "hicp_index", "M", rows)
    annual = sql_database.execute(
        "SELECT * FROM v_hicp_annual WHERE country_code='EE' AND period IN ('1980','1981') ORDER BY period"
    ).fetchall()
    assert float(annual[0]["value"]) == 101
    assert annual[0]["component_count"] == 12
    assert annual[1]["value"] is None
    assert annual[1]["component_count"] == 11
    quarterly = sql_database.execute(
        "SELECT * FROM v_hicp_quarterly WHERE country_code='EE' AND period IN ('1980-Q1','1981-Q2') ORDER BY period"
    ).fetchall()
    assert float(quarterly[0]["value"]) == 92
    assert quarterly[1]["value"] is None
    assert quarterly[1]["component_count"] == 2


@pytest.mark.integration
def test_sql_yoy_requires_the_actual_same_period_even_with_interior_gaps(sql_database):
    sql_rows(sql_database, "house_price_index", "Q", [
        ("1980-Q1", 100, None), ("1980-Q2", 110, None), ("1980-Q4", 130, None),
        ("1981-Q1", 120, None), ("1981-Q3", 140, None), ("1981-Q4", 156, None),
    ])
    result = sql_database.execute(
        "SELECT * FROM v_observation_year_over_year WHERE country_code='EE' "
        "AND indicator_code='house_price_index' AND period LIKE '1981%' ORDER BY period"
    ).fetchall()
    assert float(result[0]["year_over_year_percent"]) == pytest.approx(20)
    assert result[0]["previous_period"] == "1980-Q1"
    assert result[1]["year_over_year_percent"] is None
    assert result[1]["previous_period"] is None
    assert float(result[2]["year_over_year_percent"]) == pytest.approx(20)


@pytest.mark.integration
def test_sql_yoy_stops_at_break_and_allows_post_break_comparison(sql_database):
    sql_rows(sql_database, "annual_net_earnings", "A", [("1980", 1000, None), ("1981", 2000, "b"), ("1982", 2200, None)])
    result = sql_database.execute(
        "SELECT * FROM v_observation_year_over_year WHERE country_code='EE' "
        "AND indicator_code='annual_net_earnings' AND period IN ('1981','1982') ORDER BY period"
    ).fetchall()
    assert result[0]["year_over_year_percent"] is None
    assert float(result[1]["year_over_year_percent"]) == pytest.approx(10)


@pytest.mark.integration
def test_sql_rates_use_percentage_points_not_relative_percentage_changes(sql_database):
    sql_rows(sql_database, "hicp_annual_change", "M", [("1980-01", -1, None), ("1981-01", -2, None)])
    result = sql_database.execute(
        "SELECT * FROM v_observation_year_over_year WHERE country_code='EE' "
        "AND indicator_code='hicp_annual_change' AND period='1981-01'"
    ).fetchone()
    assert result["year_over_year_percent"] is None
    assert float(result["year_over_year_percentage_points"]) == -1
