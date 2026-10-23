import tempfile
import time
from pathlib import Path


def write_text_atomic(path: Path, content: str) -> None:
    encoded = content.encode("utf-8")
    if path.exists() and path.read_bytes() == encoded:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp", delete=False) as file:
        temporary = Path(file.name)
        file.write(encoded)
    try:
        for attempt in range(7):
            try:
                temporary.replace(path)
                return
            except PermissionError:
                if attempt == 6:
                    raise
                # Windows sync clients can briefly hold a just-written file open.
                time.sleep(min(0.1 * 2**attempt, 1))
    finally:
        temporary.unlink(missing_ok=True)
