import csv
import io
from datetime import timezone
from email.utils import parsedate_to_datetime
from itertools import product
from xml.etree import ElementTree

from pipelines.eurostat import COUNTRIES, fetch_response, validate_period, validate_value


CODELIST_BASE = "https://data-api.ecb.europa.eu/service/codelist/ECB/"


def code_labels(xml: str) -> dict[str, str]:
    try:
        root = ElementTree.fromstring(xml)
    except ElementTree.ParseError as error:
        raise ValueError("ECB returned invalid codelist XML") from error
    labels = {}
    for element in root.iter():
        if element.tag.rsplit("}", 1)[-1] != "Code":
            continue
        for child in element:
            if child.tag.rsplit("}", 1)[-1] == "Name" and child.get("{http://www.w3.org/XML/1998/namespace}lang") == "en":
                labels[element.attrib["id"]] = child.text
                break
    if not labels or any(not isinstance(label, str) or not label for label in labels.values()):
        raise ValueError("ECB codelist has no complete English labels")
    return labels


def csv_rows(content: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    required = {"KEY", "FREQ", "REF_AREA", "BS_REP_SECTOR", "BS_ITEM", "MATURITY_NOT_IRATE", "DATA_TYPE_MIR",
                "AMOUNT_CAT", "BS_COUNT_SECTOR", "CURRENCY_TRANS", "IR_BUS_COV", "UNIT", "UNIT_MULT",
                "TIME_PERIOD", "OBS_VALUE", "OBS_STATUS", "TITLE"}
    if not reader.fieldnames or not required.issubset(reader.fieldnames) or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError("ECB CSV is missing the verified MIR dimensions or observation metadata")
    rows = list(reader)
    if not rows or any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("ECB CSV is empty or contains malformed rows")
    return rows


def fetch_mir(url: str, *, timeout: float = 45) -> dict:
    response = fetch_response(url, timeout=timeout)
    rows = csv_rows(response.text)
    metadata_urls = {"unit": CODELIST_BASE + "CL_UNIT/latest", "status": CODELIST_BASE + "CL_OBS_STATUS/latest"}
    units = code_labels(fetch_response(metadata_urls["unit"], timeout=timeout).text)
    statuses = code_labels(fetch_response(metadata_urls["status"], timeout=timeout).text)
    if "PCPA" not in units:
        raise ValueError("ECB unit metadata does not contain PCPA")
    updated = None
    last_modified = response.headers.get("Last-Modified")
    if last_modified:
        updated = parsedate_to_datetime(last_modified).astimezone(timezone.utc).isoformat()
    return {
        "format": "ecb_csv", "label": rows[0]["TITLE"], "updated": updated,
        "last_modified": last_modified, "csv": response.text,
        "metadata": {"unit_labels": {"PCPA": units["PCPA"]}, "status_labels": statuses, "source_urls": metadata_urls},
    }


def parse_mir(payload: dict, *, dimensions: dict[str, str], dataset_code: str = "MIR") -> list[dict]:
    if not isinstance(payload, dict) or payload.get("format") != "ecb_csv" or not isinstance(payload.get("csv"), str):
        raise ValueError("ECB snapshot does not contain the original CSV response")
    units = payload.get("metadata", {}).get("unit_labels", {})
    statuses = payload.get("metadata", {}).get("status_labels", {})
    if not units.get("PCPA") or not isinstance(statuses, dict) or not statuses:
        raise ValueError("ECB snapshot is missing verified unit or status metadata")
    rows = csv_rows(payload["csv"])
    observations = {}
    periods = set()
    measured_countries = set()
    for row in rows:
        country, period = row["REF_AREA"], row["TIME_PERIOD"]
        if country not in COUNTRIES:
            raise ValueError(f"Unexpected ECB reference area: {country}")
        expected_key = f"{dataset_code}.M.{country}.B.A2C.AM.R.A.2250.EUR.N"
        if row["KEY"] != expected_key or any(row.get(name.upper()) != code for name, code in dimensions.items()):
            raise ValueError(f"ECB MIR dimensions differ from the verified series: {row['KEY']}")
        if row["UNIT_MULT"] != "0" or row["UNIT"] != "PCPA":
            raise ValueError("ECB borrowing rate requires unscaled percent per annum (PCPA, UNIT_MULT=0)")
        if row["TITLE"] != payload.get("label") or not row["TITLE"]:
            raise ValueError("ECB CSV contains inconsistent series titles")
        validate_period(period, "M")
        key = (country, period)
        if key in observations:
            raise ValueError(f"Duplicate ECB observation: {country}, {period}")
        status = row["OBS_STATUS"] or None
        if status is not None and status not in statuses:
            raise ValueError(f"Unknown ECB observation status: {status}")
        if status == "F":
            raise ValueError("Forecast ECB values are not supported as historical measurements")
        try:
            value = float(row["OBS_VALUE"]) if row["OBS_VALUE"] else None
        except ValueError as error:
            raise ValueError(f"Non-numeric ECB observation for {country}, {period}") from error
        value = validate_value(value, "rate", "ECB borrowing rate")
        observations[key] = {"country": country, "period": period, "value": value,
                             "status": status, "dimensions": dict(dimensions)}
        periods.add(period)
        if value is not None:
            measured_countries.add(country)
    if measured_countries != set(COUNTRIES):
        raise ValueError("ECB borrowing rates must contain measured observations for EE, LT and LV")
    return [observations.get((country, period), {"country": country, "period": period, "value": None,
            "status": None, "dimensions": dict(dimensions)}) for country, period in product(COUNTRIES, sorted(periods))]
