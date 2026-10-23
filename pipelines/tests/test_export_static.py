import json

import pytest

from pipelines.export_static import validate_observations, write_bundle


def synthetic_row(**changes):
    row = {"country": "LV", "indicator": "house_price_index", "period": "2020-Q1",
           "value": 1.0, "status": "p", "source_url": "https://example.org/test-fixture",
           "source_updated_at": "2020-06-01", "retrieved_at": "2020-06-02T00:00:00+00:00",
           "dimensions": {"unit": "I15_Q", "purchase": "TOTAL", "freq": "Q"}}
    return row | changes


@pytest.mark.parametrize("change", [
    {"country": "DE"}, {"period": "2020-Q5"}, {"period": "0000-Q1"},
    {"value": float("nan")}, {"value": True},
    {"value": -1}, {"source_url": ""}, {"retrieved_at": None}, {"indicator": "unknown"},
])
def test_export_rejects_invalid_or_unattributed_data(change):
    with pytest.raises(ValueError):
        validate_observations([synthetic_row(**change)])


def test_export_rejects_duplicates():
    with pytest.raises(ValueError, match="Duplicate"):
        validate_observations([synthetic_row(), synthetic_row()])


def test_missing_value_is_preserved_with_its_status():
    validate_observations([synthetic_row(value=None, status=":")])


def test_mixed_unit_records_cannot_be_exported():
    indicator = {"code": "house_price_index", "frequency": "Q", "unit": "2015=100",
                 "dimensions": {"unit": "I25_Q", "purchase": "TOTAL", "freq": "Q"}}
    with pytest.raises(ValueError, match="dimensions differ"):
        validate_observations([synthetic_row()], [indicator])


def test_export_is_deterministic_and_retains_csv_provenance(tmp_path):
    bundle = {"schema_version": 1, "indicators": [{"code": "house_price_index", "unit": "2015=100"}],
              "observations": [synthetic_row(value=None)]}
    write_bundle(bundle, tmp_path)
    first = (tmp_path / "observations.json").read_bytes()
    write_bundle(bundle, tmp_path)
    assert (tmp_path / "observations.json").read_bytes() == first
    assert json.loads(first)["observations"][0]["value"] is None
    assert "https://example.org/test-fixture" in (tmp_path / "observations.csv").read_text()


@pytest.mark.parametrize("code,period,value,valid", [
    ("annual_net_earnings", "2020", 0, True),
    ("annual_net_earnings", "2020", -1, False),
    ("hicp_index", "2020-01", 0, False),
    ("hicp_annual_change", "2020-01", -0.5, True),
    ("hicp_annual_change", "2020-01", -100, False),
    ("hicp_annual_change", "2020-Q1", 1, False),
])
def test_exports_apply_each_indicator_frequency_and_value_rules(code, period, value, valid):
    rows = [synthetic_row(indicator=code, period=period, value=value)]
    if valid:
        validate_observations(rows)
    else:
        with pytest.raises(ValueError):
            validate_observations(rows)
