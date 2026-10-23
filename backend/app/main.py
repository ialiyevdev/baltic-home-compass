import re
from typing import Annotated, Literal

import psycopg
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from backend.app import db, service
from backend.app.config import get_settings
from backend.app.models import AnalyticsCatalogue, ComparisonResponse, IndicatorList, ObservationPage
from backend.app.mortgage import calculate_mortgage
from backend.app.mortgage_models import CalculatorResult, MortgageRequest


app = FastAPI(title="Baltic Home Compass API", version="0.1.0")
app.add_middleware(GZipMiddleware, minimum_size=1024)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in get_settings().cors_origins.split(",")],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

PERIOD_PATTERN = r"^[1-9]\d{3}(?:-Q[1-4]|-(?:0[1-9]|1[0-2]))?$"
Period = Annotated[str | None, Query(pattern=PERIOD_PATTERN)]


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, error: RequestValidationError):
    if request.url.path != "/api/calculators/mortgage":
        return await request_validation_exception_handler(request, error)
    details = [{key: item[key] for key in ("type", "loc", "msg")} for item in error.errors()]
    return JSONResponse(status_code=422, content={"detail": details}, headers={"Cache-Control": "no-store"})


@app.post("/api/calculators/mortgage", response_model=CalculatorResult)
def mortgage_calculator(scenario: MortgageRequest, response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return calculate_mortgage(scenario)


@app.exception_handler(psycopg.Error)
async def database_error(_request: Request, _error: psycopg.Error) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "detail": "PostgreSQL is unavailable or the schema is not ready. "
            "Start PostgreSQL and run python -m database.migrate."
        },
    )


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "application": "Baltic Home Compass", "version": "0.1.0"}


@app.get("/api/ready")
def readiness() -> dict:
    with db.connect() as connection:
        result = connection.execute(
            """
            SELECT to_regclass('public.schema_migrations') IS NOT NULL
               AND to_regclass('public.countries') IS NOT NULL
               AND to_regclass('public.datasets') IS NOT NULL
               AND to_regclass('public.indicators') IS NOT NULL
               AND to_regclass('public.observations') IS NOT NULL
               AND to_regclass('public.ingestion_runs') IS NOT NULL
               AND to_regclass('public.v_house_price_annual') IS NOT NULL
               AND to_regclass('public.v_hicp_quarterly') IS NOT NULL
               AND to_regclass('public.v_hicp_annual') IS NOT NULL
               AND to_regclass('public.v_observation_year_over_year') IS NOT NULL
               AND EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'indicators'
                     AND column_name = 'status_labels'
               )
               AND EXISTS (
                   SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'public' AND table_name = 'ingestion_runs'
                     AND column_name = 'indicator_code'
               ) AS ready
            """
        ).fetchone()
        if not result["ready"]:
            raise HTTPException(status_code=503, detail="Run python -m database.migrate first.")
    return {"status": "ready", "database": "connected"}


@app.get("/api/indicators", response_model=IndicatorList)
def indicators() -> dict:
    with db.connect() as connection:
        return {"indicators": service.list_indicators(connection)}


def parse_countries(value: str) -> list[str]:
    countries = value.split(",")
    if (
        not countries
        or len(countries) > 3
        or len(set(countries)) != len(countries)
        or any(country not in {"EE", "LV", "LT"} for country in countries)
    ):
        raise HTTPException(
            status_code=422, detail="countries must be distinct comma-separated EE, LV or LT codes."
        )
    return countries


@app.get("/api/observations", response_model=ObservationPage)
def observations(
    indicator: Annotated[str, Query(pattern=r"^[a-z][a-z0-9_]{1,63}$")] = "house_price_index",
    countries: str = "EE,LV,LT",
    start: Period = None,
    end: Period = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> dict:
    country_codes = parse_countries(countries)
    if start and end and (len(start) != len(end) or start > end):
        raise HTTPException(status_code=422, detail="Use matching periods with start no later than end.")
    with db.connect() as connection:
        selected = connection.execute(
            "SELECT frequency FROM indicators WHERE code = %s", (indicator,)
        ).fetchone()
        if selected is None:
            raise HTTPException(status_code=404, detail="Unknown indicator.")
        expected = {"A": r"\d{4}", "Q": r"\d{4}-Q[1-4]", "M": r"\d{4}-(?:0[1-9]|1[0-2])"}
        for bound in (start, end):
            if bound is not None and not re.fullmatch(expected[selected["frequency"]], bound):
                raise HTTPException(status_code=422, detail="Period bounds must match the indicator frequency.")
        total, rows = service.observation_page(
            connection, indicator, country_codes, start, end, limit, offset
        )
    return {
        "indicator": indicator,
        "countries": country_codes,
        "start": start,
        "end": end,
        "total": total,
        "limit": limit,
        "offset": offset,
        "observations": rows,
    }


@app.get("/api/metadata")
def metadata() -> dict:
    with db.connect() as connection:
        return service.metadata(connection)


@app.get("/api/export")
def export() -> dict:
    from pipelines.export_static import build_bundle

    with db.connect() as connection:
        connection.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY")
        return build_bundle(connection)


@app.get("/api/analytics/catalogue", response_model=AnalyticsCatalogue)
def analytics_catalogue() -> dict:
    from pipelines.export_analytics import build_analytics_catalogue

    return build_analytics_catalogue(export())


@app.get("/api/analytics/compare", response_model=ComparisonResponse)
def compare(
    metric: Literal["housing_earnings", "housing_inflation", "real_earnings", "indicator_change"] = "housing_inflation",
    countries: str = "EE,LV,LT",
    indicator: Annotated[str | None, Query(pattern=r"^[a-z][a-z0-9_]{1,63}$")] = None,
    start: Period = None,
    end: Period = None,
    base_period: Period = None,
) -> dict:
    from backend.app.analytics import build_comparison

    country_codes = parse_countries(countries)
    if metric == "indicator_change" and indicator is None:
        raise HTTPException(status_code=422, detail="indicator_change requires an indicator code.")
    if metric != "indicator_change" and indicator is not None:
        raise HTTPException(status_code=422, detail="indicator is only used with indicator_change.")
    bundle = export()
    try:
        return build_comparison(bundle, metric, countries=country_codes, indicator=indicator,
                                start=start, end=end, base_period=base_period)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
