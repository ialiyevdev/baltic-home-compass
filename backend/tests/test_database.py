import os
from contextlib import contextmanager

import psycopg
import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.config import get_settings
from backend.app.main import app
from database import migrate


pytestmark = pytest.mark.integration


@pytest.fixture
def database(monkeypatch):
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set TEST_DATABASE_URL to verify migrations against PostgreSQL")
    monkeypatch.setenv("DATABASE_URL", url)
    get_settings.cache_clear()
    migrate.migrate()
    try:
        with db.connect() as connection:
            try:
                yield connection
            finally:
                connection.rollback()
    finally:
        get_settings.cache_clear()


def test_migration_rerun_is_idempotent(database):
    assert migrate.migrate() == []
    countries = database.execute("SELECT code FROM countries ORDER BY code").fetchall()
    assert [row["code"] for row in countries] == ["EE", "LT", "LV"]


def test_readiness_requires_the_phase_two_columns(database, monkeypatch):
    database.execute("ALTER TABLE indicators RENAME COLUMN status_labels TO unapplied_status_labels")

    @contextmanager
    def connection():
        yield database

    monkeypatch.setattr(db, "connect", connection)
    response = TestClient(app).get("/api/ready")
    assert response.status_code == 503
    assert "migrate" in response.json()["detail"]


def test_country_constraint(database):
    with pytest.raises(psycopg.errors.CheckViolation):
        with database.transaction():
            database.execute("INSERT INTO countries (code, name) VALUES ('US', 'United States')")


@pytest.mark.parametrize("value", ["NaN", "Infinity", "-Infinity", "0", "-1"])
def test_invalid_hpi_values_are_rejected(database, value):
    database.execute(
        """
        INSERT INTO datasets (code, publisher, name, source_url, frequency, attribution)
        VALUES ('constraint_test', 'Test', 'Constraint test', 'https://example.org/', 'Q', 'Test only')
        """
    )
    database.execute(
        """
        INSERT INTO indicators (code, dataset_code, name, description, unit, frequency)
        VALUES ('house_price_index', 'constraint_test', 'Test HPI', 'Test only', 'index', 'Q')
        ON CONFLICT (code) DO NOTHING
        """
    )
    run_id = database.execute(
        """
        INSERT INTO ingestion_runs (dataset_code, source_url)
        VALUES ('constraint_test', 'https://example.org/') RETURNING id
        """
    ).fetchone()["id"]
    with pytest.raises(psycopg.errors.CheckViolation):
        with database.transaction():
            database.execute(
                """
                INSERT INTO observations
                    (country_code, indicator_code, period, value, source_url, ingestion_run_id)
                VALUES ('EE', 'house_price_index', '1900-Q1', %s, 'https://example.org/', %s)
                """,
                (value, run_id),
            )


def test_api_filters_and_paginates_postgres_records(database, monkeypatch):
    database.execute(
        """
        INSERT INTO datasets (code, publisher, name, source_url, frequency, attribution)
        VALUES ('api_test', 'Test', 'API test', 'https://example.org/', 'Q', 'Test only')
        """
    )
    database.execute(
        """
        INSERT INTO indicators (code, dataset_code, name, description, unit, frequency)
        VALUES ('api_test_index', 'api_test', 'Test index', 'Test only', 'index', 'Q')
        """
    )
    run_id = database.execute(
        """
        INSERT INTO ingestion_runs (dataset_code, source_url)
        VALUES ('api_test', 'https://example.org/') RETURNING id
        """
    ).fetchone()["id"]
    for country, period, value, status in [
        ("EE", "1900-Q1", None, ":"),
        ("LT", "1900-Q1", 100, "p"),
        ("EE", "1900-Q2", 102, None),
    ]:
        database.execute(
            """
            INSERT INTO observations
                (country_code, indicator_code, period, value, status, source_url, ingestion_run_id)
            VALUES (%s, 'api_test_index', %s, %s, %s, 'https://example.org/', %s)
            """,
            (country, period, value, status, run_id),
        )

    @contextmanager
    def connection():
        yield database

    monkeypatch.setattr(db, "connect", connection)
    client = TestClient(app)
    response = client.get(
        "/api/observations?indicator=api_test_index&countries=EE,LT"
        "&start=1900-Q1&end=1900-Q2&limit=1&offset=1"
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["total"] == 3
    assert len(payload["observations"]) == 1
    assert payload["observations"][0]["country_code"] == "LT"
    assert payload["observations"][0]["value"] == 100
    assert payload["observations"][0]["status"] == "p"
    metadata = client.get("/api/metadata").json()
    dataset = next(row for row in metadata["datasets"] if row["code"] == "api_test")
    assert dataset["observation_count"] == 3
    assert dataset["latest_period"] == "1900-Q2"
    assert dataset["last_ingestion_status"] == "running"


@pytest.mark.parametrize("frequency,first,last,value,wrong_period", [
    ("A", "1900", "1901", 12000, "1901-01"),
    ("M", "1900-01", "1900-02", -0.5, "1900-Q1"),
])
def test_annual_earnings_and_negative_inflation_filters(database, monkeypatch, frequency, first, last, value, wrong_period):
    # Synthetic API records stay inside this rolled-back test transaction.
    database.execute(
        "INSERT INTO datasets (code, publisher, name, source_url, frequency, attribution) "
        "VALUES ('frequency_test', 'Test only', 'Synthetic series', 'https://example.org/', %s, 'Test only')",
        (frequency,),
    )
    database.execute(
        "INSERT INTO indicators (code, dataset_code, name, description, unit, frequency) "
        "VALUES ('frequency_test', 'frequency_test', 'Test series', 'Test only', 'Test unit', %s)",
        (frequency,),
    )
    run = database.execute(
        "INSERT INTO ingestion_runs (dataset_code, indicator_code, source_url) "
        "VALUES ('frequency_test', 'frequency_test', 'https://example.org/') RETURNING id"
    ).fetchone()["id"]
    for period in (first, last):
        database.execute(
            "INSERT INTO observations (country_code, indicator_code, period, value, status, source_url, ingestion_run_id) "
            "VALUES ('LV', 'frequency_test', %s, %s, 'b', 'https://example.org/', %s)",
            (period, value, run),
        )

    @contextmanager
    def connection():
        yield database

    monkeypatch.setattr(db, "connect", connection)
    client = TestClient(app)
    response = client.get(f"/api/observations?indicator=frequency_test&countries=LV&start={last}")
    assert response.status_code == 200
    result = response.json()
    assert result["total"] == 1
    assert result["observations"][0]["value"] == value
    assert result["observations"][0]["status"] == "b"
    assert client.get(f"/api/observations?indicator=frequency_test&start={wrong_period}").status_code == 422
