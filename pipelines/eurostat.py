import math
import re
import time
from collections.abc import Callable
from contextlib import nullcontext
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from itertools import product
from typing import Any

import httpx


COUNTRIES = ("EE", "LT", "LV")


def _retry_delay(response: httpx.Response | None, attempt: int) -> float:
    delay = min(2**attempt, 30)
    if response is None or "Retry-After" not in response.headers:
        return float(delay)
    retry_after = response.headers["Retry-After"]
    try:
        seconds = float(retry_after)
    except ValueError:
        try:
            retry_date = parsedate_to_datetime(retry_after)
            if retry_date.tzinfo is None:
                retry_date = retry_date.replace(tzinfo=timezone.utc)
            seconds = (retry_date - datetime.now(timezone.utc)).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return float(delay)
    return max(0.0, min(seconds, 30.0)) if math.isfinite(seconds) else float(delay)


def fetch_response(
    url: str,
    *,
    timeout: float = 45,
    attempts: int = 3,
    client: httpx.Client | None = None,
    sleep: Callable[[float], None] = time.sleep,
) -> httpx.Response:
    if isinstance(attempts, bool) or not isinstance(attempts, int) or attempts < 1:
        raise ValueError("attempts must be a positive integer")
    if isinstance(timeout, bool) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be a finite positive number")

    context = nullcontext(client) if client is not None else httpx.Client(follow_redirects=True)
    with context as http:
        for attempt in range(attempts):
            try:
                response = http.get(url, timeout=timeout)
            except httpx.TransportError as error:
                if attempt + 1 == attempts:
                    raise RuntimeError(
                        f"Official data request failed after {attempts} attempts: {url}: {error}"
                    ) from error
                sleep(_retry_delay(None, attempt))
                continue

            if response.is_success:
                return response

            if response.status_code == 429 or 500 <= response.status_code < 600:
                if attempt + 1 < attempts:
                    sleep(_retry_delay(response, attempt))
                    continue
            detail = response.text[:240].replace("\n", " ")
            raise RuntimeError(
                f"Official data request returned HTTP {response.status_code} on attempt {attempt + 1}: "
                f"{url}: {detail}"
            )
    raise RuntimeError("Official data request did not complete")


def fetch_json(
    url: str, *, timeout: float = 45, attempts: int = 3,
    client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep,
) -> dict[str, Any]:
    response = fetch_response(url, timeout=timeout, attempts=attempts, client=client, sleep=sleep)
    try:
        payload = response.json()
    except ValueError as error:
        raise ValueError(f"Eurostat returned invalid JSON: {url}") from error
    if not isinstance(payload, dict):
        raise ValueError(f"Eurostat response must be a JSON object: {url}")
    return payload


def _categories(dimension: dict[str, Any], name: str, size: int) -> list[str]:
    if not isinstance(dimension, dict) or not isinstance(dimension.get("category"), dict):
        raise ValueError(f"Missing category metadata for dimension {name}")
    category = dimension["category"]
    index = category.get("index")
    if index is None and size == 1 and isinstance(category.get("label"), dict):
        index = list(category["label"])
    if isinstance(index, list):
        codes = index
    elif isinstance(index, dict):
        positions = list(index.values())
        if any(type(position) is not int for position in positions):
            raise ValueError(f"Invalid category positions in dimension {name}")
        if sorted(positions) != list(range(size)):
            raise ValueError(f"Duplicate or missing category positions in dimension {name}")
        codes = sorted(index, key=index.__getitem__)
    else:
        raise ValueError(f"Missing category index for dimension {name}")
    if len(codes) != size or any(not isinstance(code, str) or not code for code in codes):
        raise ValueError(f"Invalid categories in dimension {name}")
    if len(set(codes)) != len(codes):
        raise ValueError(f"Duplicate categories in dimension {name}")
    return codes


def _cells(data: Any, size: int, name: str) -> dict[int, Any]:
    if isinstance(data, list):
        if len(data) != size:
            raise ValueError(f"Dense {name} length does not match dimension sizes")
        return dict(enumerate(data))
    if not isinstance(data, dict):
        raise ValueError(f"JSON-stat {name} must be a dense array or sparse object")
    cells = {}
    for key, value in data.items():
        if not isinstance(key, str) or not re.fullmatch(r"0|[1-9]\d*", key):
            raise ValueError(f"Invalid sparse {name} position: {key!r}")
        position = int(key)
        if position >= size:
            raise ValueError(f"Sparse {name} position exceeds dimension sizes: {key}")
        cells[position] = value
    return cells


def validate_period(period: str, frequency: str, today: date | None = None) -> None:
    patterns = {"A": r"(\d{4})", "Q": r"(\d{4})-Q([1-4])", "M": r"(\d{4})-(0[1-9]|1[0-2])"}
    labels = {"A": "annual", "Q": "quarterly", "M": "monthly"}
    if frequency not in patterns:
        raise ValueError(f"Unsupported frequency: {frequency}")
    match = re.fullmatch(patterns[frequency], period) if isinstance(period, str) else None
    if not match or int(match[1]) == 0:
        raise ValueError(f"Invalid {labels[frequency]} period: {period}")
    month = 1 if frequency == "A" else (int(match[2]) - 1) * 3 + 1 if frequency == "Q" else int(match[2])
    period_start = date(int(match[1]), month, 1)
    today = today or datetime.now(timezone.utc).date()
    if period_start > today:
        raise ValueError(f"Future {labels[frequency]} period: {period}")


def validate_value(value: Any, value_kind: str, label: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Non-numeric {label}")
    try:
        number = float(value)
    except OverflowError as error:
        raise ValueError(f"{label} must be finite") from error
    if not math.isfinite(number):
        raise ValueError(f"{label} must be finite")
    if value_kind == "positive" and number <= 0:
        raise ValueError(f"{label} must be finite and positive")
    if value_kind == "nonnegative" and number < 0:
        raise ValueError(f"{label} must be nonnegative")
    if value_kind == "rate" and number <= -100:
        raise ValueError(f"{label} must be greater than -100 percent")
    if value_kind == "percentage" and not 0 <= number <= 100:
        raise ValueError(f"{label} must be between 0 and 100 percent")
    if value_kind not in {"positive", "nonnegative", "rate", "percentage"}:
        raise ValueError(f"Unknown value validation: {value_kind}")
    return number


def parse_series(
    payload: dict[str, Any], *, dimensions: dict[str, str], frequency: str,
    value_kind: str = "positive", label: str = "indicator",
) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise ValueError("Eurostat response must be an object")
    for key in ("error", "warning"):
        if key in payload:
            raise ValueError(f"Eurostat returned {key}: {payload[key]}")
    if payload.get("class") != "dataset":
        raise ValueError("Eurostat response is not a JSON-stat dataset")
    selected = dict(dimensions)
    expected_dimensions = set(selected) | {"geo", "time"}
    if selected.get("freq") != frequency or {"geo", "time"} & set(selected):
        raise ValueError("Selection must specify its frequency and exclude geo and time")
    ids, sizes, metadata = payload.get("id"), payload.get("size"), payload.get("dimension")
    if (
        not isinstance(ids, list)
        or any(not isinstance(name, str) for name in ids)
        or len(ids) != len(expected_dimensions)
        or set(ids) != expected_dimensions
    ):
        raise ValueError(f"Unexpected {label} dimensions")
    if (
        not isinstance(sizes, list)
        or len(sizes) != len(ids)
        or any(type(size) is not int or size < 1 for size in sizes)
    ):
        raise ValueError("Invalid JSON-stat dimension sizes")
    if not isinstance(metadata, dict):
        raise ValueError("Missing JSON-stat dimension metadata")
    categories = {
        name: _categories(metadata.get(name), name, size)
        for name, size in zip(ids, sizes, strict=True)
    }
    for name, code in selected.items():
        if code not in categories[name]:
            raise ValueError(f"Requested {name}={code} is absent from Eurostat metadata")
    if set(categories["geo"]) != set(COUNTRIES):
        raise ValueError(f"{label} metadata must contain exactly EE, LT and LV")
    today = datetime.now(timezone.utc).date()
    for period in categories["time"]:
        validate_period(period, frequency, today)

    total_size = math.prod(sizes)
    values = _cells(payload.get("value"), total_size, "value")
    raw_status = payload.get("status") or {}
    if isinstance(raw_status, str):
        statuses = None
    else:
        statuses = _cells(raw_status, total_size, "status")
        if any(flag is not None and not isinstance(flag, str) for flag in statuses.values()):
            raise ValueError("JSON-stat observation statuses must be strings or null")

    positions = {name: {code: i for i, code in enumerate(codes)} for name, codes in categories.items()}
    rows = []
    measured_countries = set()
    for country, period in product(COUNTRIES, sorted(categories["time"])):
        coordinate = {**selected, "geo": country, "time": period}
        position = 0
        for name, size in zip(ids, sizes, strict=True):
            position = position * size + positions[name][coordinate[name]]
        value = validate_value(values.get(position), value_kind, f"{label} for {country}, {period}")
        if value is not None:
            measured_countries.add(country)
        status = raw_status if statuses is None else statuses.get(position)
        rows.append(
            {
                "country": country,
                "period": period,
                "value": value,
                "status": status,
                "dimensions": dict(selected),
            }
        )
    if measured_countries != set(COUNTRIES):
        missing = ", ".join(sorted(set(COUNTRIES) - measured_countries))
        raise ValueError(f"No {label} observations for {missing}")
    return rows


def parse_hpi(
    payload: dict[str, Any], *, unit: str = "I15_Q", purchase: str = "TOTAL"
) -> list[dict[str, Any]]:
    if unit.startswith("RCH"):
        raise ValueError(f"House price index requires an index unit; received {unit}")
    rows = parse_series(
        payload, dimensions={"freq": "Q", "purchase": purchase, "unit": unit},
        frequency="Q", label="house price index",
    )
    if not re.fullmatch(r"I\d{2}_Q", unit):
        raise ValueError(f"House price index requires an index unit; received {unit}")
    return rows
