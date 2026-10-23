import psycopg
from psycopg.rows import dict_row

from backend.app.config import get_settings


def connect() -> psycopg.Connection:
    return psycopg.connect(
        get_settings().database_url,
        row_factory=dict_row,
        connect_timeout=5,
        application_name="baltic_home_compass",
    )
