from pathlib import Path

import pytest

from pipelines.files import write_text_atomic


def test_transient_windows_lock_is_retried(tmp_path, monkeypatch):
    path = tmp_path / "export.json"
    original_replace = Path.replace
    attempts = []

    def transient_lock(temporary, target):
        attempts.append(target)
        if len(attempts) == 1:
            raise PermissionError("Simulated transient Windows file lock")
        return original_replace(temporary, target)

    monkeypatch.setattr(Path, "replace", transient_lock)
    monkeypatch.setattr("pipelines.files.time.sleep", lambda _: None)
    write_text_atomic(path, "validated export\n")
    assert len(attempts) == 2
    assert path.read_bytes() == b"validated export\n"


def test_persistent_lock_leaves_existing_export_intact(tmp_path, monkeypatch):
    path = tmp_path / "export.json"
    path.write_text("previous export", encoding="utf-8")

    def locked(*args):
        raise PermissionError("Simulated persistent Windows file lock")

    monkeypatch.setattr(Path, "replace", locked)
    monkeypatch.setattr("pipelines.files.time.sleep", lambda _: None)
    with pytest.raises(PermissionError):
        write_text_atomic(path, "updated export")
    assert path.read_text(encoding="utf-8") == "previous export"
    assert list(tmp_path.iterdir()) == [path]
