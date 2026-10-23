import argparse
import json
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

from psycopg.types.json import Jsonb

from backend.app.db import connect
from pipelines.catalog import COUNTRIES, ROOT, Indicator, PipelineSettings, indicator_definitions
from pipelines.eurostat import fetch_json, parse_hpi, parse_series
from pipelines.ecb import fetch_mir, parse_mir
from pipelines.files import write_text_atomic

logger = logging.getLogger(__name__)


def query_url(settings: PipelineSettings, indicator: Indicator) -> str:
    if indicator.provider == "ecb":
        key = "M." + "+".join(COUNTRIES) + ".B.A2C.AM.R.A.2250.EUR.N"
        return (settings.ecb_api_base_url.rstrip("/") + "/" + indicator.dataset_code + "/" + key
                + "?" + urlencode({"startPeriod": indicator.start_period, "format": "csvdata"}))
    params = [("lang", "EN"), *[("geo", country) for country in COUNTRIES]]
    if indicator.code != "house_price_index":
        siblings = [item for item in indicator_definitions(settings) if item.dataset_code == indicator.dataset_code]
        for dimension in sorted(indicator.dimensions):
            codes = sorted({item.dimensions[dimension] for item in siblings})
            params.extend((dimension, code) for code in codes)
    params.append(("sinceTimePeriod", indicator.start_period))
    return settings.eurostat_api_base_url.rstrip("/") + "/" + indicator.dataset_code + "?" + urlencode(params)


def snapshot_path(settings: PipelineSettings, indicator: Indicator):
    if indicator.code == "house_price_index":
        return settings.snapshot_path
    return ROOT / "data" / "snapshots" / f"{indicator.dataset_code}.json"


def parse_indicator(payload: dict, indicator: Indicator) -> list[dict]:
    if indicator.provider == "ecb":
        return parse_mir(payload, dimensions=indicator.dimensions, dataset_code=indicator.dataset_code)
    if indicator.code == "house_price_index":
        return parse_hpi(payload, unit=indicator.dimensions["unit"], purchase=indicator.dimensions["purchase"])
    return parse_series(
        payload, dimensions=indicator.dimensions, frequency=indicator.frequency,
        value_kind=indicator.value_kind, label=indicator.name.lower(),
    )


def source_metadata(payload: dict, indicator: Indicator) -> tuple[str, dict]:
    unit_dimension = indicator.unit_dimension or ("currency" if "currency" in indicator.dimensions else "unit")
    try:
        if indicator.provider == "ecb":
            unit_label = payload["metadata"]["unit_labels"][indicator.dimensions["unit"]]
        else:
            unit_label = payload["dimension"][unit_dimension]["category"]["label"][indicator.dimensions[unit_dimension]]
        dataset_name = payload["label"]
    except (KeyError, TypeError) as error:
        raise ValueError("The publisher did not provide dataset and unit labels.") from error
    if indicator.provider == "ecb":
        status_labels = payload["metadata"]["status_labels"]
    else:
        extension = payload.get("extension") or {}
        status = extension.get("status") or {}
        status_labels = status.get("label", {})
    if not isinstance(unit_label, str) or not unit_label or not isinstance(dataset_name, str) or not dataset_name:
        raise ValueError("The publisher did not provide dataset and unit labels.")
    if not isinstance(status_labels, dict) or any(
        not isinstance(key, str) or not isinstance(value, str) for key, value in status_labels.items()
    ):
        raise ValueError("Invalid observation status labels in source metadata.")
    return unit_label, status_labels


def validate_source(payload: dict, settings: PipelineSettings, indicator: Indicator) -> None:
    errors = []
    validated = 0
    for sibling in indicator_definitions(settings):
        if sibling.dataset_code == indicator.dataset_code:
            try:
                parse_indicator(payload, sibling)
                source_metadata(payload, sibling)
                validated += 1
            except ValueError as error:
                errors.append(f"{sibling.code}: {error}")
    if not validated:
        raise ValueError("No configured series validated: " + "; ".join(errors))


def load_source(
    settings: PipelineSettings, *, refresh: bool, from_snapshot: bool, indicator: Indicator | None = None,
) -> dict:
    indicator = indicator or indicator_definitions(settings)[0]
    path = snapshot_path(settings, indicator)
    url = query_url(settings, indicator)
    cached = None
    if path.exists() and not refresh:
        try:
            cached = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as error:
            if from_snapshot:
                raise ValueError("The local snapshot is invalid JSON; fetch a fresh response with --refresh.") from error
            logger.warning("Ignoring invalid cached JSON for %s.", indicator.dataset_code)
    if from_snapshot and cached is None:
        raise ValueError(f"No verified snapshot exists at {path}.")
    if cached is not None:
        valid_shape = isinstance(cached, dict) and cached.get("source_url") == url
        if from_snapshot and not valid_shape:
            raise ValueError("Snapshot query differs from configuration; restore its settings or sync live.")
        if valid_shape:
            try:
                retrieved = datetime.fromisoformat(cached["retrieved_at"])
                if retrieved.tzinfo is None:
                    raise ValueError("Snapshot retrieval timestamp must be timezone-aware.")
                age = datetime.now(timezone.utc) - retrieved
                if age < timedelta(0):
                    raise ValueError("Snapshot retrieval timestamp cannot be in the future.")
                validate_source(cached["payload"], settings, indicator)
                if from_snapshot or age < timedelta(hours=24):
                    logger.info("Using verified snapshot for %s (%s).", indicator.dataset_code, cached["retrieved_at"])
                    return cached
            except (KeyError, TypeError, ValueError) as error:
                if from_snapshot:
                    raise ValueError(f"Invalid snapshot for {indicator.dataset_code}: {error}") from error
                logger.warning("Ignoring invalid cache for %s: %s", indicator.dataset_code, error)
    payload = (fetch_mir(url, timeout=settings.api_timeout_seconds) if indicator.provider == "ecb"
               else fetch_json(url, timeout=settings.api_timeout_seconds))
    validate_source(payload, settings, indicator)
    source = {"source_url": url, "retrieved_at": datetime.now(timezone.utc).isoformat(), "payload": payload}
    write_text_atomic(path, json.dumps(source, ensure_ascii=False, indent=2, allow_nan=False) + "\n")
    return source


def register_indicator(connection, indicator: Indicator) -> None:
    connection.execute(
        "INSERT INTO datasets (code, publisher, name, source_url, frequency, attribution) "
        "VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (code) DO NOTHING",
        (indicator.dataset_code, indicator.publisher, indicator.name, indicator.source_url, indicator.frequency, indicator.attribution),
    )
    connection.execute(
        "INSERT INTO indicators (code, dataset_code, name, description, unit, frequency, dimensions) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT (code) DO NOTHING",
        (indicator.code, indicator.dataset_code, indicator.name, indicator.description,
         indicator.dimensions.get(indicator.unit_dimension or "unit", indicator.dimensions.get("currency")),
         indicator.frequency, Jsonb(indicator.dimensions)),
    )


def ingest_indicator(connection, indicator: Indicator, source: dict, run_id: int) -> int:
    payload = source["payload"]
    observations = parse_indicator(payload, indicator)
    unit_label, status_labels = source_metadata(payload, indicator)
    previous = connection.execute(
        "SELECT dataset_code, dimensions, frequency FROM indicators WHERE code = %s FOR UPDATE", (indicator.code,),
    ).fetchone()
    changed = (previous["dataset_code"] != indicator.dataset_code
               or previous["dimensions"] != indicator.dimensions or previous["frequency"] != indicator.frequency)
    if changed and connection.execute(
        "SELECT EXISTS (SELECT 1 FROM observations WHERE indicator_code = %s) AS present", (indicator.code,),
    ).fetchone()["present"]:
        raise ValueError(f"Stored definition for {indicator.code} differs from configuration; existing observations were retained.")
    connection.execute(
        "UPDATE indicators SET dataset_code = %s, name = %s, description = %s, unit = %s, "
        "frequency = %s, dimensions = %s, status_labels = %s WHERE code = %s",
        (indicator.dataset_code, indicator.name, indicator.description, unit_label, indicator.frequency,
         Jsonb(indicator.dimensions), Jsonb(status_labels), indicator.code),
    )
    connection.execute(
        "UPDATE datasets SET name = %s, publisher = %s, source_url = %s, attribution = %s WHERE code = %s",
        (payload["label"], indicator.publisher, indicator.source_url,
         f"Source: {indicator.publisher}, {payload['label']} ({indicator.dataset_code}).", indicator.dataset_code),
    )
    with connection.cursor() as cursor:
        cursor.executemany(
            "INSERT INTO observations (country_code, indicator_code, period, value, status, dimensions, "
            "source_url, source_updated_at, retrieved_at, ingestion_run_id) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (country_code, indicator_code, period) DO UPDATE SET "
            "value = EXCLUDED.value, status = EXCLUDED.status, dimensions = EXCLUDED.dimensions, "
            "source_url = EXCLUDED.source_url, source_updated_at = EXCLUDED.source_updated_at, "
            "retrieved_at = EXCLUDED.retrieved_at, ingestion_run_id = EXCLUDED.ingestion_run_id "
            "WHERE (observations.value, observations.status, observations.dimensions, observations.source_updated_at) "
            "IS DISTINCT FROM (EXCLUDED.value, EXCLUDED.status, EXCLUDED.dimensions, EXCLUDED.source_updated_at)",
            [(row["country"], indicator.code, row["period"], row["value"], row["status"], Jsonb(row["dimensions"]),
              source["source_url"], payload.get("updated"), source["retrieved_at"], run_id) for row in observations],
        )
    return len(observations)


def sync(*, refresh: bool = False, from_snapshot: bool = False, indicators: list[str] | None = None) -> int:
    if refresh and from_snapshot:
        raise ValueError("--refresh and --from-snapshot cannot be combined.")
    settings = PipelineSettings()
    definitions = indicator_definitions(settings)
    requested = set(indicators or [item.code for item in definitions])
    unknown = requested - {item.code for item in definitions}
    if unknown:
        raise ValueError(f"Unknown indicators: {', '.join(sorted(unknown))}")
    selected = [item for item in definitions if item.code in requested]
    with connect() as connection:
        with connection.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO countries (code, name) VALUES (%s, %s) ON CONFLICT (code) DO NOTHING", list(COUNTRIES.items()),
            )
        for indicator in selected:
            register_indicator(connection, indicator)
    sources: dict[str, dict | Exception] = {}
    failures = []
    total = 0
    for indicator in selected:
        with connect() as connection:
            run_id = connection.execute(
                "INSERT INTO ingestion_runs (dataset_code, indicator_code, status, source_url) "
                "VALUES (%s, %s, 'running', %s) RETURNING id",
                (indicator.dataset_code, indicator.code, query_url(settings, indicator)),
            ).fetchone()["id"]
        try:
            if indicator.dataset_code not in sources:
                try:
                    sources[indicator.dataset_code] = load_source(
                        settings, refresh=refresh, from_snapshot=from_snapshot, indicator=indicator,
                    )
                except (ValueError, RuntimeError, OSError) as error:
                    sources[indicator.dataset_code] = error
            source = sources[indicator.dataset_code]
            if isinstance(source, Exception):
                raise source
            with connect() as connection:
                count = ingest_indicator(connection, indicator, source, run_id)
                connection.execute(
                    "UPDATE ingestion_runs SET status = 'success', finished_at = now(), row_count = %s, "
                    "source_url = %s, snapshot_path = %s WHERE id = %s",
                    (count, source["source_url"], snapshot_path(settings, indicator).relative_to(ROOT).as_posix(), run_id),
                )
            total += count
            logger.info("%s: validated %s rows; inserted or updated changed observations only.", indicator.code, count)
        except Exception as error:
            with connect() as connection:
                connection.execute(
                    "UPDATE ingestion_runs SET status = 'failed', finished_at = now(), error = %s WHERE id = %s",
                    (f"{type(error).__name__}: {error}"[:2000], run_id),
                )
            failures.append(f"{indicator.code}: {type(error).__name__}: {error}")
            logger.error("%s failed; previous observations retained: %s", indicator.code, error)
    if failures:
        raise RuntimeError("Some indicators failed: " + "; ".join(failures))
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description="Retrieve and validate selected official Eurostat and ECB series.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--refresh", action="store_true", help="Bypass the 24-hour local cache.")
    group.add_argument("--from-snapshot", action="store_true", help="Explicitly import committed verified snapshots.")
    parser.add_argument("--indicator", action="append", help="Select an indicator; repeat to select several. Default: the full catalogue.")
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        sync(refresh=arguments.refresh, from_snapshot=arguments.from_snapshot, indicators=arguments.indicator)
    except Exception as error:
        logger.error("Sync failed (%s): %s", type(error).__name__, error)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
