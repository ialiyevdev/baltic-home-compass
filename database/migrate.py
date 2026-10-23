import hashlib
import sys
from pathlib import Path

import psycopg

from backend.app.db import connect


class MigrationError(Exception):
    pass


def migrate() -> list[str]:
    applied = []
    with connect() as connection:
        connection.execute("SELECT pg_advisory_xact_lock(581739013)")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                name text PRIMARY KEY,
                checksum text NOT NULL,
                applied_at timestamptz NOT NULL DEFAULT now()
            )
            """
        )
        for path in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
            content = path.read_bytes()
            checksum = hashlib.sha256(content).hexdigest()
            previous = connection.execute(
                "SELECT checksum FROM schema_migrations WHERE name = %s", (path.name,)
            ).fetchone()
            if previous:
                if previous["checksum"] != checksum:
                    raise MigrationError(f"Applied migration {path.name} has changed.")
                continue
            connection.execute(content.decode("utf-8"), prepare=False)
            connection.execute(
                "INSERT INTO schema_migrations (name, checksum) VALUES (%s, %s)",
                (path.name, checksum),
            )
            applied.append(path.name)
    return applied


def main() -> int:
    try:
        applied = migrate()
    except psycopg.Error:
        print("Migration failed. Check PostgreSQL, DATABASE_URL and database permissions.", file=sys.stderr)
        return 1
    except (MigrationError, OSError) as error:
        print(str(error), file=sys.stderr)
        return 1
    print("Applied: " + ", ".join(applied) if applied else "Database schema is current.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
