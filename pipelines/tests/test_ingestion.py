import json
import os
from contextlib import contextmanager
from copy import deepcopy
from uuid import uuid4

import psycopg
import pytest
from psycopg import sql
from psycopg.rows import dict_row

from pipelines import sync
from pipelines.catalog import ROOT, PipelineSettings, indicator_definitions
from pipelines.export_static import build_bundle

pytestmark = pytest.mark.integration


@pytest.fixture
def database(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to test ingestion in an isolated, rolled-back schema")
    connection = psycopg.connect(url, row_factory=dict_row)
    schema = f"pipeline_test_{uuid4().hex}"
    try:
        connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
        connection.execute(sql.SQL("SET LOCAL search_path TO {}").format(sql.Identifier(schema)))
        for migration in sorted((ROOT / "database" / "migrations").glob("*.sql")):
            connection.execute(migration.read_text(encoding="utf-8"), prepare=False)

        @contextmanager
        def borrowed_connection():
            with connection.transaction():
                yield connection

        monkeypatch.setattr(sync, "connect", borrowed_connection)
        monkeypatch.setattr(sync, "PipelineSettings", lambda: PipelineSettings(_env_file=None))
        yield connection
    finally:
        connection.rollback()
        connection.close()


def actual_snapshot(settings, *, indicator, **options):
    path = ROOT / "data" / "snapshots" / f"{indicator.dataset_code}.json"
    if not path.exists():
        pytest.skip(f"Verified snapshot is not available: {path.name}")
    return json.loads(path.read_text(encoding="utf-8"))


def stored_values(connection, indicator):
    return connection.execute(
        "SELECT country_code, period, value, status, dimensions, ingestion_run_id "
        "FROM observations WHERE indicator_code = %s ORDER BY country_code, period", (indicator,),
    ).fetchall()


def test_actual_snapshots_upsert_without_duplicates_and_export_metadata(database, monkeypatch):
    monkeypatch.setattr(sync, "load_source", actual_snapshot)
    first_count = sync.sync(from_snapshot=True)
    assert first_count > 0
    original_records = database.execute("SELECT * FROM observations ORDER BY indicator_code, country_code, period").fetchall()
    assert sync.sync(from_snapshot=True) == first_count
    assert database.execute("SELECT * FROM observations ORDER BY indicator_code, country_code, period").fetchall() == original_records
    assert database.execute("SELECT count(*) AS n FROM observations").fetchone()["n"] == first_count
    runs = database.execute("SELECT status, indicator_code FROM ingestion_runs").fetchall()
    assert len(runs) == 2 * len(indicator_definitions())
    assert all(run["status"] == "success" and run["indicator_code"] for run in runs)
    flags = database.execute(
        "SELECT country_code FROM observations WHERE indicator_code = 'annual_net_earnings' "
        "AND period = '2024' AND status = 'b' ORDER BY country_code"
    ).fetchall()
    assert [row["country_code"] for row in flags] == ["EE", "LT", "LV"]
    assert database.execute(
        "SELECT count(*) AS n FROM observations WHERE indicator_code = 'hicp_annual_change' AND value < 0"
    ).fetchone()["n"] > 0
    bundle = build_bundle(database)
    definitions = {item["code"]: item for item in bundle["indicators"]}
    assert len(bundle["observations"]) == first_count
    assert definitions["annual_net_earnings"]["unit"] == "Euro"
    assert definitions["annual_net_earnings"]["status_labels"]["b"] == "break in time series"
    assert all(item["last_success_at"] and item["latest_attempt"]["status"] == "success" for item in definitions.values())
    assert definitions["hicp_index"]["attribution"] == definitions["hicp_annual_change"]["attribution"]
    assert "ECOICOP" in definitions["hicp_index"]["dataset_name"]
    assert definitions["mortgage_borrowing_rate"]["publisher"] == "ECB"
    assert definitions["mortgage_borrowing_rate"]["unit"] == "Percent per annum"
    assert definitions["housing_cost_overburden"]["comparison_kind"] == "percentage_points"
    assert definitions["household_price_level"]["unit"] == "Price level indices (EU27_2020=100)"


def test_changed_definition_refuses_to_replace_existing_observations(database, monkeypatch):
    monkeypatch.setattr(sync, "load_source", actual_snapshot)
    sync.sync(indicators=["house_price_index"])
    before = stored_values(database, "house_price_index")
    monkeypatch.setattr(sync, "PipelineSettings", lambda: PipelineSettings(_env_file=None, hpi_unit="I25_Q"))
    with pytest.raises(RuntimeError, match="Stored definition.*differs"):
        sync.sync(indicators=["house_price_index"])
    assert stored_values(database, "house_price_index") == before
    assert database.execute(
        "SELECT status FROM ingestion_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()["status"] == "failed"


def test_incremental_update_changes_only_revised_observation(database, monkeypatch):
    monkeypatch.setattr(sync, "load_source", actual_snapshot)
    sync.sync(indicators=["house_price_index"])
    before = stored_values(database, "house_price_index")
    parse = sync.parse_indicator

    def revised_observation(payload, indicator):
        rows = parse(payload, indicator)
        rows[0]["value"] += 1
        rows[0]["status"] = "p"
        return rows

    monkeypatch.setattr(sync, "parse_indicator", revised_observation)
    sync.sync(indicators=["house_price_index"])
    after = stored_values(database, "house_price_index")
    assert after[0]["value"] == before[0]["value"] + 1
    assert after[0]["status"] == "p"
    assert after[0]["ingestion_run_id"] != before[0]["ingestion_run_id"]
    assert after[1:] == before[1:]


def test_one_source_failure_retains_data_and_allows_other_series_to_succeed(database, monkeypatch):
    monkeypatch.setattr(sync, "load_source", actual_snapshot)
    sync.sync()
    before = stored_values(database, "annual_net_earnings")
    calls = []

    def unavailable_earnings(settings, *, indicator, **options):
        calls.append(indicator.dataset_code)
        if indicator.code == "annual_net_earnings":
            raise RuntimeError("Test-only unavailable publisher")
        return actual_snapshot(settings, indicator=indicator)

    monkeypatch.setattr(sync, "load_source", unavailable_earnings)
    with pytest.raises(RuntimeError, match="annual_net_earnings"):
        sync.sync(refresh=True)
    assert stored_values(database, "annual_net_earnings") == before
    assert len(calls) == len({item.dataset_code for item in indicator_definitions()})
    runs = database.execute(
        "SELECT indicator_code, status FROM ingestion_runs ORDER BY id DESC LIMIT %s", (len(indicator_definitions()),),
    ).fetchall()
    assert {row["indicator_code"]: row["status"] for row in runs} == {
        item.code: "failed" if item.code == "annual_net_earnings" else "success" for item in indicator_definitions()
    }
    bundle = build_bundle(database)
    earnings = next(item for item in bundle["indicators"] if item["code"] == "annual_net_earnings")
    assert earnings["last_success_at"]
    assert earnings["latest_attempt"]["status"] == "failed"


def test_missing_hicp_rate_does_not_block_valid_index(database, monkeypatch):
    settings = PipelineSettings(_env_file=None)
    definition = sync.indicator_definitions(settings)[2]
    source = deepcopy(actual_snapshot(settings, indicator=definition))
    payload = source["payload"]
    assert payload["id"] == ["freq", "unit", "coicop18", "geo", "time"]
    times = payload["size"][-1]
    unit_position = payload["dimension"]["unit"]["category"]["index"]["RCH_A"]
    country_position = payload["dimension"]["geo"]["category"]["index"]["EE"]
    categories = payload["size"][2]
    category_position = payload["dimension"]["coicop18"]["category"]["index"]["TOTAL"]
    offset = ((unit_position * categories + category_position) * 3 + country_position) * times
    for position in range(offset, offset + times):
        payload["value"].pop(str(position), None)
    sync.validate_source(payload, settings, definition)
    monkeypatch.setattr(sync, "load_source", lambda *args, **kwargs: source)
    with pytest.raises(RuntimeError, match="hicp_annual_change"):
        sync.sync(indicators=["hicp_index", "hicp_annual_change"])
    assert database.execute(
        "SELECT count(*) AS n FROM observations WHERE indicator_code = 'hicp_index'"
    ).fetchone()["n"] == times * 3
    runs = database.execute("SELECT indicator_code, status FROM ingestion_runs").fetchall()
    assert {row["indicator_code"]: row["status"] for row in runs} == {
        "hicp_index": "success", "hicp_annual_change": "failed",
    }
