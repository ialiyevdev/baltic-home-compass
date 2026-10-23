from copy import deepcopy
from itertools import product

import httpx
import pytest

from pipelines.eurostat import fetch_json, parse_hpi


def synthetic_hpi(order=None):
    """Small invented observations used only to test JSON-stat parsing."""
    codes = {
        "freq": ["Q"],
        "purchase": ["TOTAL"],
        "unit": ["I15_Q", "I25_Q"],
        "geo": ["LV", "EE", "LT"],
        "time": ["2020-Q2", "2020-Q1"],
    }
    ids = order or ["time", "geo", "unit", "purchase", "freq"]
    values = []
    for coordinate in product(*(codes[name] for name in ids)):
        selected = dict(zip(ids, coordinate, strict=True))
        values.append(
            {"EE": 100, "LV": 200, "LT": 300}[selected["geo"]]
            + (10 if selected["unit"] == "I25_Q" else 0)
            + (2 if selected["time"] == "2020-Q2" else 1)
        )
    return {
        "class": "dataset",
        "version": "2.0",
        "id": ids,
        "size": [len(codes[name]) for name in ids],
        "dimension": {
            name: {
                "category": {
                    "index": dict(reversed(list(zip(items, range(len(items)), strict=True))))
                }
            }
            for name, items in codes.items()
        },
        "value": values,
    }


@pytest.mark.parametrize(
    "order",
    [
        ["time", "geo", "unit", "purchase", "freq"],
        ["freq", "purchase", "unit", "geo", "time"],
        ["geo", "unit", "time", "freq", "purchase"],
    ],
)
def test_dimension_order_and_positions_are_read_from_metadata(order):
    rows = parse_hpi(synthetic_hpi(order))
    assert [(row["country"], row["period"], row["value"]) for row in rows] == [
        ("EE", "2020-Q1", 101.0),
        ("EE", "2020-Q2", 102.0),
        ("LT", "2020-Q1", 301.0),
        ("LT", "2020-Q2", 302.0),
        ("LV", "2020-Q1", 201.0),
        ("LV", "2020-Q2", 202.0),
    ]
    assert all(row["dimensions"] == {"freq": "Q", "purchase": "TOTAL", "unit": "I15_Q"} for row in rows)
    assert all(row["status"] is None for row in rows)
    assert parse_hpi(synthetic_hpi(order), unit="I25_Q")[0]["value"] == 111.0


def test_sparse_values_preserve_null_observations_and_flags():
    payload = synthetic_hpi()
    payload["value"] = {str(i): value for i, value in enumerate(payload["value"]) if i != 2}
    payload["status"] = {"2": "b", "6": "p"}
    rows = parse_hpi(payload)
    missing = next(row for row in rows if row["country"] == "EE" and row["period"] == "2020-Q2")
    assert missing["value"] is None
    assert missing["status"] == "b"
    provisional = next(row for row in rows if row["country"] == "LV" and row["period"] == "2020-Q1")
    assert provisional["status"] == "p"
    assert len(rows) == 6


def test_dense_null_and_dense_or_global_status():
    payload = synthetic_hpi()
    payload["value"][2] = None
    payload["status"] = [None] * len(payload["value"])
    payload["status"][2] = "b"
    rows = parse_hpi(payload)
    assert rows[1]["value"] is None
    assert rows[1]["status"] == "b"
    payload["status"] = "p"
    assert {row["status"] for row in parse_hpi(payload)} == {"p"}


def test_list_category_indexes_are_supported():
    payload = synthetic_hpi()
    payload["dimension"]["geo"]["category"]["index"] = ["LV", "EE", "LT"]
    assert parse_hpi(payload)[0]["value"] == 101.0


def test_single_category_label_can_supply_its_index():
    payload = synthetic_hpi()
    payload["dimension"]["freq"]["category"] = {"label": {"Q": "Quarterly"}}
    assert len(parse_hpi(payload)) == 6


@pytest.mark.parametrize("selection", [{"unit": "INVALID"}, {"purchase": "DW_NEW"}])
def test_requested_dimension_must_exist(selection):
    with pytest.raises(ValueError, match="absent from Eurostat metadata"):
        parse_hpi(synthetic_hpi(), **selection)


def test_growth_rates_cannot_be_mislabelled_as_an_index():
    payload = synthetic_hpi()
    payload["dimension"]["unit"]["category"]["index"] = {"RCH_A": 0, "I25_Q": 1}
    with pytest.raises(ValueError, match="requires an index unit"):
        parse_hpi(payload, unit="RCH_A")


def test_quarterly_frequency_is_verified():
    payload = synthetic_hpi()
    payload["dimension"]["freq"]["category"]["index"] = {"A": 0}
    with pytest.raises(ValueError, match="freq=Q"):
        parse_hpi(payload)


@pytest.mark.parametrize("country", ["DE", "EU27_2020"])
def test_all_and_only_baltic_countries_are_required(country):
    payload = synthetic_hpi()
    payload["dimension"]["geo"]["category"]["index"] = {"LV": 0, "EE": 1, country: 2}
    with pytest.raises(ValueError, match="exactly EE, LT and LV"):
        parse_hpi(payload)


def test_country_with_entirely_missing_series_is_rejected():
    payload = synthetic_hpi()
    for position in (2, 8):
        payload["value"][position] = None
    with pytest.raises(ValueError, match="No house price index observations for EE"):
        parse_hpi(payload)


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan"), "100", True])
def test_invalid_index_values_are_rejected(value):
    payload = synthetic_hpi()
    payload["value"][2] = value
    with pytest.raises(ValueError, match="house price index|House price index"):
        parse_hpi(payload)


@pytest.mark.parametrize("period", ["2020Q1", "2020-Q5", "0000-Q1", "9999-Q4"])
def test_invalid_or_future_periods_are_rejected(period):
    payload = synthetic_hpi()
    payload["dimension"]["time"]["category"]["index"] = {period: 0, "2020-Q1": 1}
    with pytest.raises(ValueError, match="quarterly period"):
        parse_hpi(payload)


@pytest.mark.parametrize("duplicate", ["position", "category"])
def test_duplicate_metadata_is_rejected(duplicate):
    payload = synthetic_hpi()
    payload["dimension"]["time"]["category"]["index"] = (
        {"2020-Q1": 0, "2020-Q2": 0} if duplicate == "position" else ["2020-Q1", "2020-Q1"]
    )
    with pytest.raises(ValueError, match="Duplicate"):
        parse_hpi(payload)


@pytest.mark.parametrize("payload", [{"error": {"status": 400}}, {"warning": {"status": 413}}, {}])
def test_error_and_async_responses_are_not_datasets(payload):
    with pytest.raises(ValueError, match="Eurostat"):
        parse_hpi(payload)


@pytest.mark.parametrize("field", ["value", "status"])
def test_bad_dense_lengths_are_rejected(field):
    payload = synthetic_hpi()
    payload[field] = [None]
    with pytest.raises(ValueError, match=f"Dense {field} length"):
        parse_hpi(payload)


@pytest.mark.parametrize("position", ["-1", "12", "01", "NaN"])
def test_bad_sparse_positions_are_rejected(position):
    payload = synthetic_hpi()
    payload["value"] = {position: 100}
    with pytest.raises(ValueError, match="position"):
        parse_hpi(payload)


def test_status_flags_must_remain_strings():
    payload = synthetic_hpi()
    payload["status"] = {"0": 2}
    with pytest.raises(ValueError, match="statuses must be strings"):
        parse_hpi(payload)


def test_dimension_size_and_id_mismatch_is_rejected():
    payload = synthetic_hpi()
    payload["size"] = [1]
    with pytest.raises(ValueError, match="dimension sizes"):
        parse_hpi(payload)
    payload = synthetic_hpi()
    payload["id"][0] = "geo"
    with pytest.raises(ValueError, match="dimensions"):
        parse_hpi(payload)


def test_retryable_http_errors_obey_bounded_retry_after():
    responses = iter(
        [
            httpx.Response(503),
            httpx.Response(429, headers={"Retry-After": "900"}),
            httpx.Response(200, json={"class": "dataset"}),
        ]
    )
    delays = []
    with httpx.Client(transport=httpx.MockTransport(lambda request: next(responses))) as client:
        result = fetch_json("https://example.test/data", client=client, sleep=delays.append)
    assert result == {"class": "dataset"}
    assert delays == [1.0, 30.0]


def test_transport_timeout_is_retried():
    calls = []
    delays = []

    def handler(request):
        calls.append(request)
        if len(calls) == 1:
            raise httpx.ReadTimeout("Publisher timeout", request=request)
        return httpx.Response(200, json={"value": {}})

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        assert fetch_json("https://example.test/data", client=client, sleep=delays.append) == {"value": {}}
    assert len(calls) == 2
    assert delays == [1.0]


@pytest.mark.parametrize("retry_after", ["not a date", "nan", "inf"])
def test_invalid_retry_after_uses_exponential_delay(retry_after):
    responses = iter(
        [httpx.Response(429, headers={"Retry-After": retry_after}), httpx.Response(200, json={})]
    )
    delays = []
    with httpx.Client(transport=httpx.MockTransport(lambda request: next(responses))) as client:
        fetch_json("https://example.test/data", client=client, sleep=delays.append)
    assert delays == [1.0]


def test_retry_after_http_date_is_bounded():
    responses = iter(
        [
            httpx.Response(429, headers={"Retry-After": "Wed, 21 Oct 2099 07:28:00 GMT"}),
            httpx.Response(200, json={}),
        ]
    )
    delays = []
    with httpx.Client(transport=httpx.MockTransport(lambda request: next(responses))) as client:
        fetch_json("https://example.test/data", client=client, sleep=delays.append)
    assert delays == [30.0]


def test_permanent_http_error_is_not_retried():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(404, text="No results found")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RuntimeError, match="HTTP 404 on attempt 1"):
            fetch_json("https://example.test/data", client=client)
    assert len(calls) == 1


def test_retry_limit_reports_publisher_failure():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503, text="Publisher unavailable")

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RuntimeError, match="HTTP 503 on attempt 3"):
            fetch_json("https://example.test/data", client=client, sleep=lambda delay: None)
    assert len(calls) == 3


def test_transport_failure_reports_retry_limit():
    def handler(request):
        raise httpx.ConnectError("Connection unavailable", request=request)

    with httpx.Client(transport=httpx.MockTransport(handler)) as client:
        with pytest.raises(RuntimeError, match="failed after 2 attempts"):
            fetch_json("https://example.test/data", attempts=2, client=client, sleep=lambda delay: None)


@pytest.mark.parametrize("body", ["not json", "[]"])
def test_invalid_json_response_is_rejected_without_retry(body):
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, text=body))) as client:
        with pytest.raises(ValueError, match="JSON"):
            fetch_json("https://example.test/data", client=client)


@pytest.mark.parametrize("options", [{"attempts": 0}, {"attempts": True}, {"timeout": 0}, {"timeout": float("inf")}])
def test_invalid_request_options_are_rejected(options):
    with pytest.raises(ValueError):
        fetch_json("https://example.test/data", **options)


def test_parsing_does_not_modify_original_payload():
    payload = synthetic_hpi()
    original = deepcopy(payload)
    parse_hpi(payload)
    assert payload == original
