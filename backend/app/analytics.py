import math
import re
from collections import defaultdict
from collections.abc import Iterable
from typing import Any


COUNTRIES = ("EE", "LV", "LT")
METRICS = ("housing_earnings", "housing_inflation", "real_earnings", "indicator_change")
INDEX_UNIT = "Index, selected base = 100"
POINT_UNIT = "Percentage points from selected base"
METHODOLOGY_SOURCES = [
    {"title": "Eurostat house price index methodology", "url": "https://ec.europa.eu/eurostat/cache/metadata/en/prc_hpi_inx_esms.htm"},
    {"title": "Eurostat HICP annual average indices", "url": "https://ec.europa.eu/eurostat/databrowser/view/prc_hicp_ainr/default/table?lang=en"},
]


def _ordinal(period: str, frequency: str) -> int:
    patterns = {"A": r"([1-9]\d{3})", "Q": r"([1-9]\d{3})-Q([1-4])", "M": r"([1-9]\d{3})-(0[1-9]|1[0-2])"}
    match = re.fullmatch(patterns[frequency], period) if isinstance(period, str) else None
    if not match:
        raise ValueError(f"Expected a {frequency} period; received {period!r}.")
    size = {"A": 1, "Q": 4, "M": 12}[frequency]
    return int(match[1]) * size + (int(match[2]) - 1 if size > 1 else 0)


def _period(ordinal: int, frequency: str) -> str:
    size = {"A": 1, "Q": 4, "M": 12}[frequency]
    year, offset = divmod(ordinal, size)
    return str(year) if frequency == "A" else f"{year}-Q{offset + 1}" if frequency == "Q" else f"{year}-{offset + 1:02d}"


def _flags(rows: Iterable[dict]) -> list[str]:
    return sorted({row["status"] for row in rows if row.get("status")})


def _broken(flags: list[str]) -> bool:
    return any("b" in flag.lower() for flag in flags)


def _point(value: float | None, flags: list[str], periods: list[str], reason: str | None = None) -> dict:
    return {"value": value, "flags": flags, "source_periods": periods, "reason": reason}


def _number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("Analytics require finite numeric observations or nulls.")
    try:
        number = float(value)
    except OverflowError as error:
        raise ValueError("Analytics require finite numeric observations or nulls.") from error
    if not math.isfinite(number):
        raise ValueError("Analytics require finite numeric observations or nulls.")
    return number


def _direct(rows: dict[str, dict], positive: bool = False) -> dict[str, dict]:
    result = {}
    for period, row in rows.items():
        value = _number(row.get("value"))
        reason = "Missing published observation." if value is None else None
        if positive and value is not None and value <= 0:
            value, reason = None, "A positive index is required."
        result[period] = _point(value, _flags([row]), [period], reason)
    return result


def _aggregate(rows: dict[str, dict], source_frequency: str, target_frequency: str) -> dict[str, dict]:
    groups: dict[str, list[str]] = defaultdict(list)
    for period in rows:
        target = period[:4] if target_frequency == "A" else f"{period[:4]}-Q{(int(period[-2:]) - 1) // 3 + 1}"
        groups[target].append(period)
    result = {}
    for target in sorted(groups):
        year = target[:4]
        if source_frequency == "Q":
            expected = [f"{year}-Q{quarter}" for quarter in range(1, 5)]
        else:
            first = 1 if target_frequency == "A" else (int(target[-1]) - 1) * 3 + 1
            count = 12 if target_frequency == "A" else 3
            expected = [f"{year}-{month:02d}" for month in range(first, first + count)]
        components = [rows[period] for period in expected if period in rows]
        flags = _flags(components)
        values = [_number(rows.get(period, {}).get("value")) for period in expected]
        reason = None
        if any(value is None or value <= 0 for value in values):
            reason = f"Requires all {len(expected)} positive {source_frequency} observations; no partial-period average is used."
        elif any(_broken(_flags([rows[period]])) for period in expected[1:]):
            reason = "A source break falls inside this aggregation period."
        value = math.fsum(value / len(expected) for value in values) if reason is None else None
        result[target] = _point(value, flags, expected, reason)
    return result


def _ratio(left: dict[str, dict], right: dict[str, dict]) -> dict[str, dict]:
    result = {}
    for period in sorted(left.keys() | right.keys()):
        numerator, denominator = left.get(period), right.get(period)
        reason = "One of the aligned source components is unavailable."
        value = None
        if numerator and denominator:
            if numerator["value"] is not None and denominator["value"] is not None and denominator["value"] > 0:
                value, reason = numerator["value"] / denominator["value"], None
                if not math.isfinite(value):
                    value, reason = None, "The aligned ratio is not finite."
            else:
                reason = numerator["reason"] or denominator["reason"] or reason
        points = [point for point in (numerator, denominator) if point]
        result[period] = _point(
            value, sorted({flag for point in points for flag in point["flags"]}),
            sorted({source for point in points for source in point["source_periods"]}), reason,
        )
    return result


def _prepare(bundle: dict, metric: str, indicator: str | None, countries: list[str]) -> dict:
    metadata = {item["code"]: item for item in bundle.get("indicators", [])}
    if metric == "indicator_change":
        if not indicator:
            raise ValueError("indicator_change requires an indicator code.")
        name = metadata.get(indicator, {}).get("name", indicator)
        frequency = metadata.get(indicator, {}).get("frequency", "A")
        kind = metadata.get(indicator, {}).get("comparison_kind")
        if kind is None:
            kind = "percentage_points" if indicator == "hicp_annual_change" else "index" if indicator in {"house_price_index", "annual_net_earnings", "hicp_index"} else None
        title = name + ": change from a common base"
        method = "Published percentage observations minus their base value, in percentage points." if kind == "percentage_points" else "Each country's published value divided by its own common-period base value, multiplied by 100."
        required = [indicator]
        components = [(indicator, name, metadata.get(indicator, {}).get("unit", ""))]
    elif metric == "housing_earnings":
        title, frequency, kind = "House prices and modelled net earnings", "A", "index"
        required = ["house_price_index", "annual_net_earnings"]
        components = [("hpi", "House price index, annual average", "HPI index"), ("earnings", "Annual net earnings", "EUR per year")]
        method = "Arithmetic mean of exactly four quarterly HPI levels, aligned to the same annual net-earnings year. Both series are independently normalized to 100 in the same base year."
    elif metric == "housing_inflation":
        title, frequency, kind = "Nominal and HICP-adjusted house price trends", "Q", "index"
        required = ["house_price_index", "hicp_index"]
        components = [("nominal_hpi", "Nominal house price index", "HPI index"), ("real_hpi", "HICP-adjusted house price index", "HPI / HICP"), ("hicp", "Consumer price index, quarterly average", "HICP index")]
        method = "Quarterly HICP is the arithmetic mean of exactly three monthly index levels. Nominal HPI = 100 × HPI / base HPI. HICP-adjusted HPI = 100 × (HPI / HICP) / (base HPI / base HICP). HICP is independently normalized to the same base."
    else:
        title, frequency, kind = "Nominal and HICP-adjusted modelled net earnings", "A", "index"
        required = ["annual_net_earnings", "hicp_index"]
        components = [("nominal_earnings", "Annual net earnings", "EUR per year"), ("real_earnings", "HICP-adjusted net earnings trend", "EUR / HICP"), ("hicp", "Consumer price index, annual average", "HICP index")]
        method = "Annual HICP is the arithmetic mean of exactly twelve monthly index levels. The earnings/HICP ratio is normalized to 100 in the same base year; its level is not a consumer-euro amount."
    sources = [metadata[code] for code in required if code in metadata]
    issue = None
    if frequency not in {"A", "Q", "M"} or kind not in {"index", "percentage_points"}:
        issue = "The indicator has no supported comparison definition."
    if any(code not in metadata for code in required):
        issue = "A required official source series is unavailable."
    if metric != "indicator_change" and issue is None:
        expected = {"house_price_index": "Q", "annual_net_earnings": "A", "hicp_index": "M"}
        for code in required:
            dims = metadata[code].get("dimensions", {})
            if metadata[code].get("frequency") != expected[code]:
                issue = "A required source has an incompatible frequency."
            if code == "house_price_index" and (dims.get("purchase") != "TOTAL" or not re.fullmatch(r"I\d{2}_Q", dims.get("unit", ""))):
                issue = "Housing comparisons require a total residential house price index."
            if code == "hicp_index" and (dims.get("coicop18") != "TOTAL" or not re.fullmatch(r"I\d{2}", dims.get("unit", ""))):
                issue = "The inflation adjustment requires the all-items HICP index."
            if code == "annual_net_earnings" and any(dims.get(key) != value for key, value in {"currency": "EUR", "estruct": "NET", "ecase": "P1_NCH_AW100"}.items()):
                issue = "The earnings comparison requires the specified annual net-EUR model case."
    if issue:
        return {"title": title, "frequency": frequency if frequency in {"A", "Q", "M"} else "A", "kind": kind, "components": components, "raw": {}, "method": method, "caveats": [], "sources": sources, "issue": issue}
    indexed: dict[tuple[str, str], dict[str, dict]] = defaultdict(dict)
    for row in bundle.get("observations", []):
        country, code = row.get("country"), row.get("indicator")
        if country not in countries or code not in required:
            continue
        period = row["period"]
        _ordinal(period, metadata[code]["frequency"])
        if period in indexed[country, code]:
            raise ValueError("Duplicate observations cannot enter an analytical comparison.")
        if "dimensions" in row and row["dimensions"] != metadata[code].get("dimensions", {}):
            raise ValueError("Observation dimensions differ from the analytical source definition.")
        if row.get("status") is not None and not isinstance(row["status"], str):
            raise ValueError("Observation flags must be strings or null.")
        indexed[country, code][period] = row
    raw = {}
    for country in countries:
        if metric == "indicator_change":
            positive = metadata[indicator].get("value_kind") == "positive" or indicator in {"house_price_index", "hicp_index"}
            raw[country, indicator] = _direct(indexed[country, indicator], positive=positive)
        elif metric == "housing_earnings":
            raw[country, "hpi"] = _aggregate(indexed[country, "house_price_index"], "Q", "A")
            raw[country, "earnings"] = _direct(indexed[country, "annual_net_earnings"])
        elif metric == "housing_inflation":
            raw[country, "nominal_hpi"] = _direct(indexed[country, "house_price_index"], positive=True)
            raw[country, "hicp"] = _aggregate(indexed[country, "hicp_index"], "M", "Q")
            raw[country, "real_hpi"] = _ratio(raw[country, "nominal_hpi"], raw[country, "hicp"])
        else:
            raw[country, "nominal_earnings"] = _direct(indexed[country, "annual_net_earnings"])
            raw[country, "hicp"] = _aggregate(indexed[country, "hicp_index"], "M", "A")
            raw[country, "real_earnings"] = _ratio(raw[country, "nominal_earnings"], raw[country, "hicp"])
    caveats = ["Changes describe the selected statistical series; they do not explain causes or measure household affordability.", "Missing observations remain gaps. No values are interpolated. Rankings use the same base and end periods for every selected country.", "A cumulative comparison stops at a source break. A break-period base can begin the new segment."]
    if "annual_net_earnings" in required:
        caveats.append("Net earnings describe a single-person tax-model case, not a median wage or actual household income. The 2024 compiler break prevents comparison across 2023–2024.")
    if "house_price_index" in required:
        caveats.append("An HPI is a price-change index, not a property price or price per square metre.")
    if metric == "indicator_change":
        caveats.extend(source.get("source_notes", "") for source in sources if source.get("source_notes"))
    return {"title": title, "frequency": frequency, "kind": kind, "components": components, "raw": raw, "method": method, "caveats": caveats, "sources": sources, "issue": issue}


def _common_periods(raw: dict, kind: str) -> list[str]:
    periods = sorted({period for values in raw.values() for period in values})
    return [period for period in periods if all(
        period in values and values[period]["value"] is not None
        and (kind == "percentage_points" or values[period]["value"] >= 0)
        for values in raw.values()
    )]


def _crosses_break(raw: dict, base: str, end: str) -> bool:
    return any(base < period <= end and _broken(point["flags"]) for values in raw.values() for period, point in values.items())


def _valid_bases(raw: dict, common: list[str], kind: str) -> list[str]:
    return [base for base in common if (kind == "percentage_points" or all(values[base]["value"] > 0 for values in raw.values()))
            and any(end > base and not _crosses_break(raw, base, end) for end in common)]


def build_comparison(
    bundle: dict, metric: str, *, countries: list[str] | None = None,
    start: str | None = None, end: str | None = None, base_period: str | None = None,
    indicator: str | None = None,
) -> dict:
    if metric not in METRICS:
        raise ValueError("Unknown analytical metric.")
    countries = list(COUNTRIES if countries is None else countries)
    if not countries or len(countries) > 3 or len(set(countries)) != len(countries) or any(country not in COUNTRIES for country in countries):
        raise ValueError("Select distinct EE, LV or LT country codes.")
    prepared = _prepare(bundle, metric, indicator, countries)
    frequency, raw, kind = prepared["frequency"], prepared["raw"], prepared["kind"]
    for bound in (start, end, base_period):
        if bound is not None:
            _ordinal(bound, frequency)
    if start and end and start > end:
        raise ValueError("start must be no later than end.")
    if base_period and ((start and base_period < start) or (end and base_period > end)):
        raise ValueError("base_period must fall within the selected range.")
    observed = sorted({period for values in raw.values() for period in values if (not start or period >= start) and (not end or period <= end)})
    periods = [_period(value, frequency) for value in range(_ordinal(observed[0], frequency), _ordinal(observed[-1], frequency) + 1)] if observed else []
    common = [period for period in _common_periods(raw, kind) if period in periods]
    valid_bases = _valid_bases(raw, common, kind)
    if base_period is None and common:
        last_break = max((period for values in raw.values() for period, point in values.items() if _broken(point["flags"]) and period <= common[-1]), default="")
        base_period = next((period for period in common if period >= last_break and (kind == "percentage_points" or all(values[period]["value"] > 0 for values in raw.values()))), None)
    if base_period is None and common:
        base_period = common[0]
    result = {
        "id": metric + (":" + indicator if metric == "indicator_change" else ""),
        "metric": metric, "indicator": indicator, "status": "unavailable", "title": prepared["title"],
        "frequency": frequency, "unit": POINT_UNIT if kind == "percentage_points" else INDEX_UNIT,
        "base_period": base_period, "start_period": periods[0] if periods else None, "end_period": None,
        "available_periods": common, "base_periods": valid_bases, "countries": countries,
        "series": [], "rankings": [], "rankings_by_period": {}, "exclusions": [],
        "method": prepared["method"], "caveats": prepared["caveats"], "sources": prepared["sources"],
        "methodology_sources": METHODOLOGY_SOURCES if metric != "indicator_change" else [],
    }
    if prepared["issue"]:
        result["caveats"].append(prepared["issue"])
        return result
    if base_period not in common or (kind != "percentage_points" and any(values[base_period]["value"] <= 0 for values in raw.values())):
        result["caveats"].append("The common base is unavailable or cannot be used as a positive denominator.")
        return result
    for country in countries:
        for component, label, raw_unit in prepared["components"]:
            values = raw[country, component]
            base = values[base_period]["value"]
            points = []
            for period in periods:
                source = values.get(period, _point(None, [], [], "Missing source period."))
                value, change, reason = None, None, source["reason"]
                if period < base_period:
                    reason = "Before the selected common base period."
                elif any(base_period < date <= period and _broken(point["flags"]) for date, point in values.items()):
                    reason = "A source break separates this period from the selected base."
                elif source["value"] is not None:
                    if kind == "percentage_points":
                        value = change = source["value"] - base
                    elif source["value"] >= 0:
                        value = 100 * (source["value"] / base)
                        change = value - 100
                    else:
                        reason = "A nonnegative comparable value is required."
                    if value is not None and not math.isfinite(value):
                        value, change, reason = None, None, "The derived value is not finite."
                point = {"period": period, "value": value, "raw_value": source["value"], "change": change, "flags": source["flags"], "source_periods": source["source_periods"], "reason": reason}
                points.append(point)
                if reason and period >= base_period:
                    result["exclusions"].append({"country": country, "component": component, "period": period, "reason": reason})
            result["series"].append({"country": country, "component": component, "label": label, "unit": result["unit"], "raw_unit": raw_unit, "change_unit": "pp" if kind == "percentage_points" else "%", "points": points})
    aligned = [period for period in common if period >= base_period and all(next(point for point in series["points"] if point["period"] == period)["value"] is not None for series in result["series"])]
    for period in aligned:
        rankings = []
        for component, _label, _unit in prepared["components"]:
            rows = []
            for series in result["series"]:
                if series["component"] == component:
                    point = next(point for point in series["points"] if point["period"] == period)
                    rows.append({"component": component, "country": series["country"], "change": point["change"], "unit": series["change_unit"], "base_value": raw[series["country"], component][base_period]["value"], "end_value": point["raw_value"]})
            rows.sort(key=lambda row: (-row["change"], row["country"]))
            rank, previous = 0, None
            for row in rows:
                if previous is None or not math.isclose(row["change"], previous, rel_tol=1e-12, abs_tol=1e-9):
                    rank += 1
                row["rank"], previous = rank, row["change"]
            rankings.extend(rows)
        result["rankings_by_period"][period] = rankings
    if aligned:
        result["end_period"] = aligned[-1]
        result["rankings"] = result["rankings_by_period"][aligned[-1]]
    if len(aligned) >= 2:
        result["status"] = "available"
    else:
        result["caveats"].append("At least two compatible common periods are required for a change comparison.")
    return result


def list_metrics(bundle: dict) -> list[dict]:
    requests = [(metric, None) for metric in METRICS if metric != "indicator_change"]
    requests += [("indicator_change", source["code"]) for source in bundle.get("indicators", [])]
    catalog = []
    for metric, indicator in requests:
        comparison = build_comparison(bundle, metric, indicator=indicator)
        catalog.append({key: comparison[key] for key in ("id", "metric", "indicator", "title", "frequency", "unit", "available_periods", "base_periods")}
                       | {"default_base_period": comparison["base_period"], "status": comparison["status"], "components": [{"id": series["component"], "label": series["label"]} for series in comparison["series"] if series["country"] == COUNTRIES[0]]})
    return catalog
