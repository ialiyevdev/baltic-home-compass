import json
from datetime import datetime, timezone

import pytest

from pipelines import sync
from pipelines.catalog import PipelineSettings


@pytest.fixture
def settings(tmp_path):
    class LocalSettings(PipelineSettings):
        @property
        def snapshot_path(self):
            return tmp_path / "snapshot.json"
    return LocalSettings(_env_file=None)


def source_url(settings):
    return (settings.eurostat_api_base_url + settings.hpi_dataset_code
            + "?lang=EN&geo=EE&geo=LV&geo=LT&sinceTimePeriod=2020-Q1")


def test_recent_snapshot_avoids_upstream_request(settings, monkeypatch):
    source = {"source_url": source_url(settings), "retrieved_at": datetime.now(timezone.utc).isoformat(),
              "payload": {"test_only": True}}
    settings.snapshot_path.write_text(json.dumps(source), encoding="utf-8")
    monkeypatch.setattr(sync, "validate_source", lambda *args: None)
    monkeypatch.setattr(sync, "fetch_json", lambda *args, **kwargs: pytest.fail("Cached response requested the network"))
    assert sync.load_source(settings, refresh=False, from_snapshot=False) == source


def test_explicit_offline_import_requires_a_real_snapshot_file(settings):
    with pytest.raises(ValueError, match="No verified snapshot exists"):
        sync.load_source(settings, refresh=False, from_snapshot=True)


def test_offline_import_rejects_different_query(settings):
    settings.snapshot_path.write_text(json.dumps({"source_url": "https://example.org/test-only"}), encoding="utf-8")
    with pytest.raises(ValueError, match="differs from configuration"):
        sync.load_source(settings, refresh=False, from_snapshot=True)


def test_forced_refresh_recovers_from_corrupted_cache(settings, monkeypatch):
    settings.snapshot_path.write_text("incomplete JSON", encoding="utf-8")
    monkeypatch.setattr(sync, "fetch_json", lambda *args, **kwargs: {"test_only": True})
    monkeypatch.setattr(sync, "validate_source", lambda *args: None)
    result = sync.load_source(settings, refresh=True, from_snapshot=False)
    assert result["payload"] == {"test_only": True}
    assert json.loads(settings.snapshot_path.read_text(encoding="utf-8")) == result


def test_only_total_purchase_scope_is_accepted():
    with pytest.raises(ValueError):
        PipelineSettings(_env_file=None, hpi_purchase="DW_NEW")


@pytest.mark.parametrize("retrieved_at", ["2020-01-01T00:00:00", "9999-01-01T00:00:00+00:00", "not a timestamp"])
def test_offline_import_rejects_invalid_retrieval_timestamps(settings, retrieved_at):
    source = {"source_url": source_url(settings), "retrieved_at": retrieved_at, "payload": {"test_only": True}}
    settings.snapshot_path.write_text(json.dumps(source), encoding="utf-8")
    with pytest.raises(ValueError, match="Invalid snapshot"):
        sync.load_source(settings, refresh=False, from_snapshot=True)


def test_invalid_live_response_cannot_replace_verified_snapshot(settings, monkeypatch):
    original = '{"test_only": "Previously retained snapshot"}'
    settings.snapshot_path.write_text(original, encoding="utf-8")
    monkeypatch.setattr(sync, "fetch_json", lambda *args, **kwargs: {"error": {"status": 400}})
    with pytest.raises(ValueError, match="No configured series validated"):
        sync.load_source(settings, refresh=True, from_snapshot=False)
    assert settings.snapshot_path.read_text(encoding="utf-8") == original
