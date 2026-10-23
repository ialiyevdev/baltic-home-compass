from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


class Indicator(BaseModel):
    code: str
    dataset_code: str
    name: str
    description: str
    unit: str
    frequency: str
    dimensions: dict[str, Any]
    publisher: str
    source_url: str
    latest_period: str | None
    observation_count: int
    dataset_name: str | None = None
    attribution: str | None = None
    source_updated_at: str | None = None
    retrieved_at: datetime | None = None
    measured_count: int = 0
    missing_count: int = 0
    status_labels: dict[str, str] = Field(default_factory=dict)
    source_notes: str = ""
    value_kind: str | None = None
    comparison_kind: Literal["index", "percentage_points"] | None = None


class AnalyticalPoint(BaseModel):
    period: str
    value: float | None
    raw_value: float | None
    change: float | None = None
    flags: list[str] = Field(default_factory=list)
    source_periods: list[str] = Field(default_factory=list)
    reason: str | None = None


class AnalyticalSeries(BaseModel):
    country: Literal["EE", "LV", "LT"]
    component: str
    label: str
    unit: str
    raw_unit: str
    change_unit: str
    points: list[AnalyticalPoint]


class CountryRanking(BaseModel):
    component: str
    country: Literal["EE", "LV", "LT"]
    rank: int
    change: float
    unit: str
    base_value: float
    end_value: float


class AnalyticalExclusion(BaseModel):
    country: str
    component: str
    period: str
    reason: str


class ComparisonResponse(BaseModel):
    id: str
    metric: str
    indicator: str | None = None
    status: Literal["available", "unavailable"]
    title: str
    frequency: Literal["A", "Q", "M"]
    unit: str
    base_period: str | None
    start_period: str | None
    end_period: str | None
    available_periods: list[str]
    base_periods: list[str]
    countries: list[str]
    series: list[AnalyticalSeries]
    rankings: list[CountryRanking]
    rankings_by_period: dict[str, list[CountryRanking]] = Field(default_factory=dict)
    exclusions: list[AnalyticalExclusion]
    method: str
    caveats: list[str]
    sources: list[dict[str, Any]]
    methodology_sources: list[dict[str, str]] = Field(default_factory=list)


class AnalysisCatalogueEntry(BaseModel):
    key: str
    metric: str
    indicator: str | None
    title: str
    frequency: Literal["A", "Q", "M"]
    unit: str
    components: list[dict[str, str]]
    default_base: str | None
    available_bases: list[str]
    scenarios: list[ComparisonResponse]


class AnalyticsCatalogue(BaseModel):
    schema_version: Literal[1]
    exported_at: str | None
    alignment: str
    analyses: list[AnalysisCatalogueEntry]


class IndicatorList(BaseModel):
    indicators: list[Indicator]


class Observation(BaseModel):
    country_code: str
    indicator_code: str
    period: str
    value: float | None
    status: str | None
    dimensions: dict[str, Any]
    source_url: str
    source_updated_at: str | None
    retrieved_at: datetime
    ingestion_run_id: int


class ObservationPage(BaseModel):
    indicator: str
    countries: list[str]
    start: str | None
    end: str | None
    total: int
    limit: int
    offset: int
    observations: list[Observation]
