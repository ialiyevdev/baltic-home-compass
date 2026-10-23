import argparse
import csv
import io
import json
from datetime import datetime
from pathlib import Path

import pandas as pd

from backend.app.db import connect
from pipelines.catalog import COUNTRIES, ROOT, indicator_definitions
from pipelines.eurostat import validate_period, validate_value
from pipelines.files import write_text_atomic


def timestamp(value) -> str | None:
    return value.isoformat() if isinstance(value, datetime) else value


def validate_observations(observations: list[dict], indicators: list[dict] | None = None) -> None:
    if not observations:
        return
    frame = pd.DataFrame(observations)
    if frame.duplicated(["country", "indicator", "period"]).any():
        raise ValueError("Duplicate observations cannot be exported.")
    if not frame["country"].isin(COUNTRIES).all():
        raise ValueError("Unexpected country in export.")
    configured = {item.code: item for item in indicator_definitions()}
    if not frame["indicator"].isin(configured).all():
        raise ValueError("Unconfigured indicator in export.")
    definitions = {item["code"]: item for item in indicators} if indicators is not None else None
    for row in observations:
        definition = configured[row["indicator"]]
        validate_period(row["period"], definition.frequency)
        validate_value(row["value"], definition.value_kind, definition.name)
        if row.get("status") is not None and not isinstance(row["status"], str):
            raise ValueError("Observation status must be a string or null.")
        if not row.get("source_url", "").startswith("https://") or not row.get("retrieved_at"):
            raise ValueError("Observation is missing source provenance.")
        if definitions is not None:
            indicator = definitions.get(row["indicator"])
            if not indicator or row["dimensions"] != indicator["dimensions"]:
                raise ValueError("Observation dimensions differ from the indicator definition.")
            if indicator["frequency"] != definition.frequency or not indicator["unit"]:
                raise ValueError("Indicator is missing its frequency or unit.")


def build_bundle(connection) -> dict:
    countries = connection.execute("SELECT code, name FROM countries ORDER BY code").fetchall()
    indicators = connection.execute(
        "SELECT i.*, d.name AS dataset_name, d.publisher, d.source_url, d.attribution, "
        "max(o.source_updated_at) AS source_updated_at, max(o.retrieved_at) AS retrieved_at, "
        "max(o.period) FILTER (WHERE o.value IS NOT NULL) AS latest_period, "
        "count(o.period) AS observation_count, count(o.value) AS measured_count "
        "FROM indicators i JOIN datasets d ON d.code = i.dataset_code "
        "LEFT JOIN observations o ON o.indicator_code = i.code AND EXISTS "
        "(SELECT 1 FROM ingestion_runs r WHERE r.id = o.ingestion_run_id AND r.status = 'success') "
        "GROUP BY i.code, d.code ORDER BY i.code"
    ).fetchall()
    observations = connection.execute(
        "SELECT o.country_code AS country, o.indicator_code AS indicator, o.period, o.value, "
        "o.status, o.dimensions, o.source_url, o.source_updated_at, o.retrieved_at "
        "FROM observations o JOIN ingestion_runs r ON r.id = o.ingestion_run_id "
        "WHERE r.status = 'success' ORDER BY o.indicator_code, o.period, o.country_code"
    ).fetchall()
    for row in observations:
        row["value"] = float(row["value"]) if row["value"] is not None else None
        row["retrieved_at"] = timestamp(row["retrieved_at"])
    validate_observations(observations, indicators)
    catalogue = {item.code: item for item in indicator_definitions()}
    for indicator in indicators:
        indicator["retrieved_at"] = timestamp(indicator["retrieved_at"])
        definition = catalogue.get(indicator["code"])
        indicator["source_notes"] = definition.source_notes if definition else ""
        if definition:
            indicator["comparison_kind"] = definition.comparison_kind
            indicator["value_kind"] = definition.value_kind
        indicator["last_success_at"] = timestamp(connection.execute(
            "SELECT max(finished_at) AS finished_at FROM ingestion_runs "
            "WHERE indicator_code = %s AND status = 'success'", (indicator["code"],),
        ).fetchone()["finished_at"])
        latest = connection.execute(
            "SELECT status, started_at, finished_at, error FROM ingestion_runs "
            "WHERE indicator_code = %s ORDER BY id DESC LIMIT 1", (indicator["code"],),
        ).fetchone()
        indicator["latest_attempt"] = {key: timestamp(value) for key, value in latest.items()} if latest else None
    success = connection.execute(
        "SELECT max(finished_at) AS finished_at FROM ingestion_runs WHERE status = 'success'"
    ).fetchone()["finished_at"]
    latest_attempt = connection.execute(
        "SELECT status, started_at, finished_at, error FROM ingestion_runs ORDER BY id DESC LIMIT 1"
    ).fetchone()
    if latest_attempt:
        latest_attempt = {key: timestamp(value) for key, value in latest_attempt.items()}
    return {
        "schema_version": 1,
        "exported_at": timestamp(success),
        "countries": countries,
        "indicators": indicators,
        "observations": observations,
        "pipeline": {"status": "success" if success else "not_synced",
                     "last_success_at": timestamp(success), "latest_attempt": latest_attempt},
    }


def write_bundle(bundle: dict, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    rendered = json.dumps(bundle, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    write_text_atomic(output / "observations.json", rendered)
    buffer = io.StringIO(newline="")
    columns = ["country", "indicator", "period", "value", "status", "unit", "frequency", "dataset", "publisher",
               "source_url", "source_updated_at", "retrieved_at", "dimensions"]
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    definitions = {item["code"]: item for item in bundle["indicators"]}
    for row in bundle["observations"]:
        record = {key: row.get(key) for key in columns}
        indicator = definitions[row["indicator"]]
        record.update(unit=indicator["unit"], frequency=indicator.get("frequency"),
                      dataset=indicator.get("dataset_code"), publisher=indicator.get("publisher"))
        record["dimensions"] = json.dumps(row["dimensions"], sort_keys=True)
        writer.writerow(record)
    write_text_atomic(output / "observations.csv", buffer.getvalue())


def main() -> None:
    from pipelines.export_analytics import build_analytics_catalogue

    parser = argparse.ArgumentParser(description="Export validated PostgreSQL observations for the static frontend.")
    parser.add_argument("--output", type=Path, default=ROOT / "frontend" / "public" / "data")
    arguments = parser.parse_args()
    with connect() as connection:
        with connection.transaction():
            connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
            bundle = build_bundle(connection)
    analytics = build_analytics_catalogue(bundle)
    analytics_json = json.dumps(analytics, separators=(",", ":"), ensure_ascii=False, allow_nan=False) + "\n"
    write_bundle(bundle, arguments.output)
    write_text_atomic(arguments.output / "analytics.json", analytics_json)
    print(f"Exported {len(bundle['observations'])} observations to {arguments.output}.")


if __name__ == "__main__":
    main()
