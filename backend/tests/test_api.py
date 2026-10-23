from contextlib import contextmanager
from datetime import datetime, timezone

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend.app import db, service
from backend.app.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_liveness_does_not_require_postgres(client, monkeypatch):
    def unavailable():
        raise AssertionError("Liveness must not access the database")

    monkeypatch.setattr(db, "connect", unavailable)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


@pytest.mark.parametrize("endpoint", [
    "/api/ready", "/api/indicators", "/api/metadata", "/api/export",
    "/api/analytics/catalogue", "/api/analytics/compare",
])
def test_database_failure_is_unavailable_without_credentials(client, monkeypatch, endpoint):
    def unavailable():
        raise psycopg.OperationalError("password=must-not-be-returned")

    monkeypatch.setattr(db, "connect", unavailable)
    response = client.get(endpoint)
    assert response.status_code == 503
    assert "must-not-be-returned" not in response.text
    assert "database.migrate" in response.json()["detail"]


@pytest.mark.parametrize(
    "query",
    [
        "countries=US",
        "countries=LV,LV",
        "countries=",
        "countries=EE,LV,LT,US",
        "start=2024-Q5",
        "start=2024-13",
        "start=0000",
        "start=0000-01",
        "start=2024-Q2&end=2024-Q1",
        "start=2024&end=2024-Q1",
        "limit=0",
        "limit=2001",
        "offset=-1",
        "indicator=invalid-code",
    ],
)
def test_invalid_filters_fail_before_accessing_database(client, monkeypatch, query):
    def unexpected_connection():
        raise AssertionError("Invalid filters must fail before connecting")

    monkeypatch.setattr(db, "connect", unexpected_connection)
    assert client.get(f"/api/observations?{query}").status_code == 422


class Result:
    def __init__(self, row):
        self.row = row

    def fetchone(self):
        return self.row


class Connection:
    def __init__(self, row):
        self.row = row

    def execute(self, *_args, **_kwargs):
        return Result(self.row)


def stub_connection(monkeypatch, row):
    @contextmanager
    def connection():
        yield Connection(row)

    monkeypatch.setattr(db, "connect", connection)


def test_readiness_detects_missing_migration(client, monkeypatch):
    stub_connection(monkeypatch, {"ready": False})
    response = client.get("/api/ready")
    assert response.status_code == 503
    assert "migrate" in response.json()["detail"]


def test_unknown_indicator(client, monkeypatch):
    stub_connection(monkeypatch, None)
    assert client.get("/api/observations?indicator=unknown").status_code == 404


def test_frequency_must_match_period_bound(client, monkeypatch):
    stub_connection(monkeypatch, {"frequency": "Q"})
    response = client.get("/api/observations?start=2024-01")
    assert response.status_code == 422
    assert "frequency" in response.json()["detail"]


def test_observations_preserve_missing_values_and_flags(client, monkeypatch):
    stub_connection(monkeypatch, {"frequency": "Q"})

    def page(_connection, indicator, countries, start, end, limit, offset):
        assert (indicator, countries, start, end, limit, offset) == (
            "house_price_index", ["EE", "LV"], "2024-Q1", "2024-Q2", 1, 2
        )
        return 3, [{
            "country_code": "LV", "indicator_code": "house_price_index",
            "period": "2024-Q2", "value": None, "status": ":",
            "dimensions": {"unit": "I15_Q"}, "source_url": "https://ec.europa.eu/",
            "source_updated_at": "2024-10-01", "retrieved_at": datetime(2024, 10, 2, tzinfo=timezone.utc),
            "ingestion_run_id": 1,
        }]

    monkeypatch.setattr(service, "observation_page", page)
    response = client.get(
        "/api/observations?countries=EE,LV&start=2024-Q1&end=2024-Q2&limit=1&offset=2"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert payload["observations"][0]["value"] is None
    assert payload["observations"][0]["status"] == ":"


@pytest.mark.parametrize("frequency,start,end", [
    ("A", "2020", "2025"),
    ("Q", "2020-Q1", "2026-Q2"),
    ("M", "2020-01", "2026-09"),
])
def test_period_filters_keep_the_indicator_frequency(client, monkeypatch, frequency, start, end):
    stub_connection(monkeypatch, {"frequency": frequency})

    def page(_connection, _indicator, _countries, actual_start, actual_end, *_pagination):
        assert (actual_start, actual_end) == (start, end)
        return 0, []

    monkeypatch.setattr(service, "observation_page", page)
    response = client.get(f"/api/observations?start={start}&end={end}")
    assert response.status_code == 200
    assert response.json()["start"] == start
    assert response.json()["end"] == end


@pytest.mark.parametrize("query", [
    "metric=unknown", "metric=indicator_change", "countries=LV,LV",
    "countries=US", "base_period=2025-Q5", "indicator=house_price_index",
])
def test_invalid_analytics_queries_are_rejected_before_loading_data(client, monkeypatch, query):
    from backend.app import main

    def unexpected_data():
        raise AssertionError("Invalid analytics query must fail before reading data")

    monkeypatch.setattr(main, "export", unexpected_data)
    assert client.get(f"/api/analytics/compare?{query}").status_code == 422


def test_missing_analytical_sources_return_an_explicit_unavailable_response(client, monkeypatch):
    from backend.app import main

    monkeypatch.setattr(main, "export", lambda: {"countries": [], "indicators": [], "observations": []})
    response = client.get("/api/analytics/compare?metric=housing_earnings")
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "unavailable"
    assert result["series"] == []
    assert result["rankings"] == []
    assert any("source" in caveat.lower() for caveat in result["caveats"])


def test_api_catalogue_matches_the_static_catalogue_builder(client, monkeypatch):
    from backend.app import main
    from pipelines.export_analytics import build_analytics_catalogue

    bundle = {"schema_version": 1, "exported_at": None, "countries": [], "indicators": [], "observations": []}
    monkeypatch.setattr(main, "export", lambda: bundle)
    response = client.get("/api/analytics/catalogue")
    assert response.status_code == 200
    assert response.json() == build_analytics_catalogue(bundle)
