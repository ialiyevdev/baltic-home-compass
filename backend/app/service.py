from datetime import datetime, timezone

import psycopg

from pipelines.catalog import indicator_definitions


def list_indicators(connection: psycopg.Connection) -> list[dict]:
    rows = connection.execute(
        """
        SELECT i.code, i.dataset_code, i.name, i.description, i.unit,
               i.frequency, i.dimensions, i.status_labels, d.publisher, d.source_url,
               d.name AS dataset_name, d.attribution,
               max(o.period) FILTER (WHERE o.value IS NOT NULL) AS latest_period,
               count(o.period) AS observation_count, count(o.value) AS measured_count,
               count(o.period) - count(o.value) AS missing_count,
               max(o.source_updated_at) AS source_updated_at,
               max(o.retrieved_at) AS retrieved_at
        FROM indicators AS i
        JOIN datasets AS d ON d.code = i.dataset_code
        LEFT JOIN observations AS o ON o.indicator_code = i.code
        GROUP BY i.code, d.code
        ORDER BY i.code
        """
    ).fetchall()
    definitions = {item.code: item for item in indicator_definitions()}
    for row in rows:
        definition = definitions.get(row["code"])
        if definition:
            row.update(source_notes=definition.source_notes, value_kind=definition.value_kind,
                       comparison_kind=getattr(definition, "comparison_kind", "index"))
    return rows


def observation_page(
    connection: psycopg.Connection,
    indicator: str,
    countries: list[str],
    start: str | None,
    end: str | None,
    limit: int,
    offset: int,
) -> tuple[int, list[dict]]:
    conditions = ["indicator_code = %s", "country_code = ANY(%s)"]
    parameters: list = [indicator, countries]
    if start is not None:
        conditions.append("period >= %s")
        parameters.append(start)
    if end is not None:
        conditions.append("period <= %s")
        parameters.append(end)
    where = " AND ".join(conditions)
    total = connection.execute(
        f"SELECT count(*) AS total FROM observations WHERE {where}", parameters
    ).fetchone()["total"]
    rows = connection.execute(
        f"""
        SELECT country_code, indicator_code, period, value, status, dimensions,
               source_url, source_updated_at, retrieved_at, ingestion_run_id
        FROM observations
        WHERE {where}
        ORDER BY period, country_code
        LIMIT %s OFFSET %s
        """,
        [*parameters, limit, offset],
    ).fetchall()
    return total, rows


def metadata(connection: psycopg.Connection) -> dict:
    countries = connection.execute("SELECT code, name FROM countries ORDER BY code").fetchall()
    datasets = connection.execute(
        """
        SELECT d.code, d.name, d.publisher, d.source_url, d.frequency, d.attribution,
               latest.status AS last_ingestion_status,
               latest.started_at AS last_ingestion_started_at,
               latest.finished_at AS last_ingestion_finished_at,
               latest.row_count AS last_ingestion_row_count,
               latest.error AS last_ingestion_error,
               successful.finished_at AS last_successful_ingestion,
               (SELECT count(*) FROM indicators i WHERE i.dataset_code = d.code)
                   AS indicator_count,
               (SELECT count(*) FROM observations o JOIN indicators i
                   ON i.code = o.indicator_code WHERE i.dataset_code = d.code)
                   AS observation_count,
               (SELECT max(o.period) FROM observations o JOIN indicators i
                   ON i.code = o.indicator_code WHERE i.dataset_code = d.code
                   AND o.value IS NOT NULL)
                   AS latest_period
        FROM datasets d
        LEFT JOIN LATERAL (
            SELECT status, started_at, finished_at, row_count, error
            FROM ingestion_runs WHERE dataset_code = d.code
            ORDER BY started_at DESC, id DESC LIMIT 1
        ) latest ON true
        LEFT JOIN LATERAL (
            SELECT finished_at FROM ingestion_runs
            WHERE dataset_code = d.code AND status = 'success'
            ORDER BY finished_at DESC, id DESC LIMIT 1
        ) successful ON true
        ORDER BY d.code
        """
    ).fetchall()
    return {
        "generated_at": datetime.now(timezone.utc),
        "countries": countries,
        "datasets": datasets,
    }
