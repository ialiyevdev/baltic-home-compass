import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app import db
from backend.app.main import app
from backend.app.mortgage import calculate_mortgage
from backend.app.mortgage_models import MortgageRequest


EXAMPLE = json.loads((Path(__file__).resolve().parents[2] / "data/fixtures/mortgage-cases.json").read_text(encoding="utf-8"))["cases"][0]["input"]


@pytest.fixture
def client(monkeypatch):
    def unexpected_connection():
        raise AssertionError("Personal financial scenarios must not access PostgreSQL")

    monkeypatch.setattr(db, "connect", unexpected_connection)
    return TestClient(app)


def test_mortgage_endpoint_is_stateless_and_matches_the_pure_engine(client):
    response = client.post("/api/calculators/mortgage", json=EXAMPLE)
    assert response.status_code == 200
    assert response.json() == calculate_mortgage(MortgageRequest.model_validate(EXAMPLE))
    assert response.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("changes", [
    {"property_price": True}, {"property_price": "150000"}, {"property_price": -1},
    {"property_price": 1.001}, {"monthly_income": -1}, {"annual_rate": -1},
    {"annual_rate": 0.0000001}, {"down_payment": {"mode": "amount", "value": 150000.01}},
    {"term_years": 0.1}, {"rate_offsets": [0]}, {"unexpected": "not stored"},
])
def test_invalid_api_scenarios_are_rejected_before_any_database_access(client, changes):
    response = client.post("/api/calculators/mortgage", json=EXAMPLE | changes)
    assert response.status_code == 422


def test_missing_income_field_is_rejected_but_explicit_null_is_valid(client):
    incomplete = EXAMPLE.copy()
    del incomplete["monthly_income"]
    assert client.post("/api/calculators/mortgage", json=incomplete).status_code == 422
    response = client.post("/api/calculators/mortgage", json=EXAMPLE | {"monthly_income": None})
    assert response.status_code == 200
    assert response.json()["affordability"]["remaining_income"] is None


def test_json_booleans_and_nonfinite_tokens_never_become_financial_amounts(client):
    payload = json.dumps(EXAMPLE).replace('"property_price": 150000', '"property_price": NaN')
    response = client.post("/api/calculators/mortgage", content=payload, headers={"Content-Type": "application/json"})
    assert response.status_code == 422


def test_calculator_cors_allows_a_local_json_post(client):
    response = client.options("/api/calculators/mortgage", headers={
        "Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
    })
    assert response.status_code == 200
    assert "POST" in response.headers["access-control-allow-methods"]


def test_mortgage_endpoint_requires_a_post_body(client):
    assert client.get("/api/calculators/mortgage").status_code == 405


def test_generated_openapi_example_is_a_complete_valid_request(client):
    example = client.get("/openapi.json").json()["components"]["schemas"]["MortgageRequest"]["example"]
    assert client.post("/api/calculators/mortgage", json=example).status_code == 200
