import csv
import io
from copy import deepcopy

import httpx
import pytest

from pipelines import ecb
from pipelines.catalog import indicator_definitions


@pytest.fixture
def definition():
    return next(item for item in indicator_definitions() if item.code == "mortgage_borrowing_rate")


def render(rows):
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=list(rows[0]))
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue()


def synthetic_payload(definition):
    # These invented rates are isolated parser fixtures, never production assets.
    rows = []
    for country in ("EE", "LV", "LT"):
        for period in ("2020-01", "2020-02"):
            rows.append({"KEY": f"MIR.M.{country}.B.A2C.AM.R.A.2250.EUR.N", "REF_AREA": country,
                         **{name.upper(): code for name, code in definition.dimensions.items()},
                         "UNIT_MULT": "0", "TIME_PERIOD": period, "OBS_VALUE": "2.5", "OBS_STATUS": "A",
                         "TITLE": "Test-only cost of borrowing"})
    return {"format": "ecb_csv", "label": "Test-only cost of borrowing", "csv": render(rows),
            "metadata": {"unit_labels": {"PCPA": "Percent per annum"},
                         "status_labels": {"A": "Normal value", "M": "Missing value", "F": "Forecast value"}}}


def test_verified_dimensions_statuses_and_units_are_retained(definition):
    payload = synthetic_payload(definition)
    rows = ecb.parse_mir(payload, dimensions=definition.dimensions)
    assert len(rows) == 6
    assert {row["country"] for row in rows} == {"EE", "LV", "LT"}
    assert all(row["value"] == 2.5 and row["status"] == "A" for row in rows)
    assert all(row["dimensions"] == definition.dimensions for row in rows)


@pytest.mark.parametrize("change", [
    {"REF_AREA": "DE"}, {"KEY": "MIR.M.EE.B.A2C.A.R.A.2250.EUR.N"}, {"FREQ": "Q"},
    {"BS_ITEM": "A2B"}, {"DATA_TYPE_MIR": "B"}, {"UNIT": "PC"}, {"UNIT_MULT": "2"},
    {"OBS_VALUE": "NaN"}, {"OBS_VALUE": "-100"}, {"OBS_VALUE": "unknown"},
    {"OBS_STATUS": "X"}, {"OBS_STATUS": "F"}, {"TIME_PERIOD": "2020-Q1"},
    {"TIME_PERIOD": "9999-01"}, {"TITLE": "Different statistical definition"},
])
def test_invalid_ecb_measurements_and_metadata_are_rejected(definition, change):
    payload = synthetic_payload(definition)
    rows = ecb.csv_rows(payload["csv"])
    rows[0].update(change)
    payload["csv"] = render(rows)
    with pytest.raises(ValueError):
        ecb.parse_mir(payload, dimensions=definition.dimensions)


def test_missing_values_and_absent_country_periods_remain_missing(definition):
    payload = synthetic_payload(definition)
    rows = ecb.csv_rows(payload["csv"])
    rows[0].update(OBS_VALUE="", OBS_STATUS="M")
    rows = [row for row in rows if not (row["REF_AREA"] == "LV" and row["TIME_PERIOD"] == "2020-02")]
    payload["csv"] = render(rows)
    parsed = ecb.parse_mir(payload, dimensions=definition.dimensions)
    assert next(row for row in parsed if row["country"] == "EE" and row["period"] == "2020-01")["status"] == "M"
    missing = next(row for row in parsed if row["country"] == "LV" and row["period"] == "2020-02")
    assert missing["value"] is None and missing["status"] is None


def test_duplicate_csv_observations_are_rejected(definition):
    payload = synthetic_payload(definition)
    rows = ecb.csv_rows(payload["csv"])
    payload["csv"] = render(rows + [deepcopy(rows[0])])
    with pytest.raises(ValueError, match="Duplicate"):
        ecb.parse_mir(payload, dimensions=definition.dimensions)


def test_country_with_no_actual_values_is_rejected(definition):
    payload = synthetic_payload(definition)
    rows = ecb.csv_rows(payload["csv"])
    payload["csv"] = render([row for row in rows if row["REF_AREA"] != "LV"])
    with pytest.raises(ValueError, match="EE, LT and LV"):
        ecb.parse_mir(payload, dimensions=definition.dimensions)


@pytest.mark.parametrize("content", ["<html>Unavailable</html>", "not XML", '<Code id="A"><Name>Missing English language</Name></Code>'])
def test_invalid_codelists_are_rejected(content):
    with pytest.raises(ValueError):
        ecb.code_labels(content)


def test_csv_fetch_preserves_last_modified_and_downloads_official_labels(definition, monkeypatch):
    payload = synthetic_payload(definition)
    calls = []

    def response(url, **options):
        calls.append(url)
        if "CL_UNIT" in url:
            return httpx.Response(200, text='<Root><Code id="PCPA"><Name xml:lang="en">Percent per annum</Name></Code></Root>')
        if "CL_OBS_STATUS" in url:
            return httpx.Response(200, text='<Root><Code id="A"><Name xml:lang="en">Normal value</Name></Code></Root>')
        return httpx.Response(200, text=payload["csv"], headers={"Last-Modified": "Thu, 01 Oct 2026 08:00:00 GMT"})

    monkeypatch.setattr(ecb, "fetch_response", response)
    downloaded = ecb.fetch_mir("https://example.test/test-only")
    assert downloaded["csv"] == payload["csv"]
    assert downloaded["updated"] == "2026-10-01T08:00:00+00:00"
    assert downloaded["metadata"]["status_labels"] == {"A": "Normal value"}
    assert len(calls) == 3
