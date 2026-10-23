from pathlib import Path
from dataclasses import dataclass
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[1]
COUNTRIES = {"EE": "Estonia", "LV": "Latvia", "LT": "Lithuania"}
INDICATOR_CODE = "house_price_index"
INDICATOR_CODES = (
    INDICATOR_CODE, "annual_net_earnings", "hicp_index", "hicp_annual_change",
    "median_equivalised_income", "household_consumption_expenditure", "household_consumption_volume",
    "housing_cost_overburden", "household_price_level", "rent_price_index", "mortgage_borrowing_rate",
)
DESCRIPTION = (
    "Changes in residential property prices paid by households, covering new and "
    "existing dwellings. This index is not an asking price, a price per square metre, "
    "or a measure of the cost of an individual home."
)


class PipelineSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    eurostat_api_base_url: str = (
        "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/"
    )
    hpi_dataset_code: str = Field(default="prc_hpi_q", pattern=r"^[a-zA-Z0-9_]+$")
    hpi_unit: str = Field(default="I15_Q", pattern=r"^I(?:15|25)_Q$")
    hpi_purchase: Literal["TOTAL"] = "TOTAL"
    hpi_start_period: str = Field(default="2020-Q1", pattern=r"^\d{4}-Q[1-4]$")
    earnings_dataset_code: str = Field(default="earn_nt_net", pattern=r"^[a-zA-Z0-9_]+$")
    earnings_start_period: str = Field(default="2020", pattern=r"^\d{4}$")
    hicp_dataset_code: str = Field(default="prc_hicp_minr", pattern=r"^[a-zA-Z0-9_]+$")
    hicp_start_period: str = Field(default="2020-01", pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    income_dataset_code: str = Field(default="ilc_di03", pattern=r"^[a-zA-Z0-9_]+$")
    consumption_dataset_code: str = Field(default="nama_10_cp18", pattern=r"^[a-zA-Z0-9_]+$")
    overburden_dataset_code: str = Field(default="ilc_lvho07a", pattern=r"^[a-zA-Z0-9_]+$")
    price_level_dataset_code: str = Field(default="prc_ppp_ind_1", pattern=r"^[a-zA-Z0-9_]+$")
    annual_start_period: str = Field(default="2020", pattern=r"^\d{4}$")
    ecb_api_base_url: str = "https://data-api.ecb.europa.eu/service/data/"
    ecb_dataset_code: str = Field(default="MIR", pattern=r"^[a-zA-Z0-9_]+$")
    ecb_start_period: str = Field(default="2020-01", pattern=r"^\d{4}-(0[1-9]|1[0-2])$")
    api_timeout_seconds: float = Field(default=45, gt=0, le=180)

    @property
    def source_url(self) -> str:
        return (
            "https://ec.europa.eu/eurostat/databrowser/view/"
            f"{self.hpi_dataset_code}/default/table?lang=en"
        )

    @property
    def attribution(self) -> str:
        return f"Source: Eurostat, House price index ({self.hpi_dataset_code})."

    @property
    def snapshot_path(self) -> Path:
        return ROOT / "data" / "snapshots" / f"{self.hpi_dataset_code}.json"


@dataclass(frozen=True)
class Indicator:
    code: str
    dataset_code: str
    name: str
    description: str
    frequency: Literal["A", "Q", "M"]
    dimensions: dict[str, str]
    start_period: str
    value_kind: Literal["positive", "nonnegative", "rate", "percentage"]
    source_notes: str
    provider: Literal["eurostat", "ecb"] = "eurostat"
    unit_dimension: str | None = None
    comparison_kind: Literal["index", "percentage_points"] = "index"

    @property
    def publisher(self) -> str:
        return "ECB" if self.provider == "ecb" else "Eurostat"

    @property
    def source_url(self) -> str:
        if self.provider == "ecb":
            return f"https://data.ecb.europa.eu/data/datasets/{self.dataset_code}"
        return f"https://ec.europa.eu/eurostat/databrowser/view/{self.dataset_code}/default/table?lang=en"

    @property
    def attribution(self) -> str:
        return f"Source: {self.publisher}, {self.name} ({self.dataset_code})."


def indicator_definitions(settings: PipelineSettings | None = None) -> tuple[Indicator, ...]:
    settings = settings or PipelineSettings()
    return (
        Indicator(
            INDICATOR_CODE, settings.hpi_dataset_code, "House price index", DESCRIPTION, "Q",
            {"freq": "Q", "purchase": settings.hpi_purchase, "unit": settings.hpi_unit},
            settings.hpi_start_period, "positive",
            "Index levels compare each country with its own base year. A higher index does not "
            "mean homes cost more in that country. This series covers total residential property.",
        ),
        Indicator(
            "annual_net_earnings", settings.earnings_dataset_code, "Annual net earnings",
            "Annual net earnings in euro for a single person without children earning 100% of "
            "the average earning. Net earnings are calculated from gross earnings using the "
            "tax and employee social contribution rules for this illustrative case.", "A",
            {"freq": "A", "currency": "EUR", "estruct": "NET", "ecase": "P1_NCH_AW100"},
            settings.earnings_start_period, "nonnegative",
            "This is an illustrative tax-model case, not the median wage or an observed household "
            "income. The compiler changed from OECD to JRC (EUROMOD) in 2024; source flag b marks "
            "this break, so changes across 2023–2024 are not directly comparable.",
        ),
        Indicator(
            "hicp_index", settings.hicp_dataset_code, "Consumer price index (HICP)",
            "Monthly Harmonised Index of Consumer Prices for the total consumer basket, "
            "using ECOICOP version 2 and the reference period 2025=100.", "M",
            {"freq": "M", "unit": "I25", "coicop18": "TOTAL"}, settings.hicp_start_period,
            "positive", "ECOICOP version 2, total consumer basket; 2025=100. This measures price "
            "changes, not euro costs or a personal budget. Published historical observations "
            "use the current classification.",
        ),
        Indicator(
            "hicp_annual_change", settings.hicp_dataset_code, "Consumer price inflation (HICP)",
            "Monthly HICP annual rate of change, in percent, for the total consumer basket "
            "under ECOICOP version 2. Each month is compared with the same month one year earlier.",
            "M", {"freq": "M", "unit": "RCH_A", "coicop18": "TOTAL"},
            settings.hicp_start_period, "rate",
            "Percentage change from the same month one year earlier, not month-on-month inflation "
            "or an annual-average rate. ECOICOP version 2, total consumer basket; household "
            "experiences differ.",
            comparison_kind="percentage_points",
        ),
        Indicator(
            "median_equivalised_income", settings.income_dataset_code, "Median equivalised disposable income",
            "Annual median equivalised disposable income in euro, covering all ages and both sexes. "
            "Household disposable income is adjusted for household size and composition and assigned to each member.",
            "A", {"freq": "A", "age": "TOTAL", "sex": "T", "statinfo": "MED_EI", "unit": "EUR"},
            settings.annual_start_period, "nonnegative",
            "EU-SILC periods label the survey year; income refers to the previous calendar year. "
            "For example, survey 2025 measures income in 2024. This equivalised, person-based median "
            "is not an actual household's income, a wage, or a monthly budget. Values are nominal annual euro.",
        ),
        Indicator(
            "household_consumption_expenditure", settings.consumption_dataset_code,
            "Household consumption expenditure",
            "Domestic-territory household final consumption expenditure in national accounts, "
            "at current prices in million euro.",
            "A", {"freq": "A", "unit": "CP_MEUR", "coicop18": "TOTAL"},
            settings.annual_start_period, "positive",
            "This aggregate includes resident and non-resident households' spending on the domestic "
            "territory and excludes residents' spending abroad. It is not an individual household's "
            "or per-person spending. Country totals depend on population and prices. Use the "
            "separately published chain-linked volume index to study real expenditure changes.",
        ),
        Indicator(
            "household_consumption_volume", settings.consumption_dataset_code,
            "Household consumption volume",
            "Official chain-linked volume index of domestic-territory household final consumption expenditure, 2020=100.",
            "A", {"freq": "A", "unit": "CLV_I20", "coicop18": "TOTAL"},
            settings.annual_start_period, "positive",
            "This domestic-territory national-accounts volume measure removes price effects using its own "
            "national-accounts methods. It is not calculated by dividing nominal expenditure by HICP "
            "and does not describe a particular household's purchasing power or spending.",
        ),
        Indicator(
            "housing_cost_overburden", settings.overburden_dataset_code, "Housing cost overburden",
            "Percentage of the population living in households where total housing costs exceed "
            "40% of disposable household income; both amounts are net of housing allowances.",
            "A", {"freq": "A", "unit": "PC", "rskpovth": "TOTAL", "age": "TOTAL", "sex": "T"},
            settings.annual_start_period, "percentage",
            "EU-SILC total population across all ages, sexes and poverty statuses, living in private "
            "households. This is the share of people facing overburden, not the average share of "
            "income spent on housing. Costs include utilities and other recurring housing expenses. "
            "The survey-year label is retained; income generally refers to the preceding year.",
            comparison_kind="percentage_points",
        ),
        Indicator(
            "household_price_level", settings.price_level_dataset_code, "Household consumption price level",
            "Price level index for household final consumption expenditure, with EU27 (2020 composition)=100.",
            "A", {"freq": "A", "indic_ppp": "PLI_EU27_2020", "ppp_cat18": "E011"},
            settings.annual_start_period, "positive",
            "A cross-country price-level comparison based on purchasing power parities. The EU "
            "reference equals 100 in each year; this is not a consumer-price inflation index, euro "
            "amount, or a personal cost-of-living estimate. COICOP 2018 household final consumption.",
            unit_dimension="indic_ppp",
        ),
        Indicator(
            "rent_price_index", settings.hicp_dataset_code, "Actual rent price index (HICP)",
            "Monthly HICP index for actual rental payments made for housing (CP041), using ECOICOP "
            "version 2 and the reference period 2025=100.",
            "M", {"freq": "M", "unit": "I25", "coicop18": "CP041"},
            settings.hicp_start_period, "positive",
            "This index measures changes in actual rental payments for housing in the HICP "
            "consumer basket. It is not a new-listing rent, an average monthly rent in euro, "
            "a city-level estimate, or imputed rent for owner-occupied homes.",
        ),
        Indicator(
            "mortgage_borrowing_rate", settings.ecb_dataset_code, "Cost of borrowing for house purchase",
            "ECB harmonised cost-of-borrowing indicator for new house-purchase loans to households "
            "and non-profit institutions serving households, denominated in euro; percent per annum.",
            "M", {"freq": "M", "bs_rep_sector": "B", "bs_item": "A2C", "maturity_not_irate": "AM",
                  "data_type_mir": "R", "amount_cat": "A", "bs_count_sector": "2250",
                  "currency_trans": "EUR", "ir_bus_cov": "N", "unit": "PCPA"},
            settings.ecb_start_period, "rate",
            "A national new-business benchmark, calculated with moving-average volume weights. "
            "Annualised agreed rate (AAR) / narrowly defined effective rate (NDER); it is not "
            "necessarily APRC, a bank offer, or a personalised mortgage rate. ECB MIR keys are "
            "M.<country>.B.A2C.AM.R.A.2250.EUR.N.",
            provider="ecb", comparison_kind="percentage_points",
        ),
    )


def source_notes(code: str) -> str:
    return next((item.source_notes for item in indicator_definitions() if item.code == code), "")
