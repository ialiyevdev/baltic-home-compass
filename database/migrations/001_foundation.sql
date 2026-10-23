CREATE TABLE countries (
    code text PRIMARY KEY CHECK (code IN ('EE', 'LV', 'LT')),
    name text NOT NULL UNIQUE
);

INSERT INTO countries (code, name) VALUES
    ('EE', 'Estonia'), ('LV', 'Latvia'), ('LT', 'Lithuania');

CREATE TABLE datasets (
    code text PRIMARY KEY,
    publisher text NOT NULL,
    name text NOT NULL,
    source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
    frequency text NOT NULL CHECK (frequency IN ('A', 'Q', 'M')),
    attribution text NOT NULL
);

CREATE TABLE indicators (
    code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,63}$'),
    dataset_code text NOT NULL REFERENCES datasets(code),
    name text NOT NULL,
    description text NOT NULL,
    unit text NOT NULL,
    frequency text NOT NULL CHECK (frequency IN ('A', 'Q', 'M')),
    dimensions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dimensions) = 'object')
);

CREATE TABLE ingestion_runs (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dataset_code text NOT NULL REFERENCES datasets(code),
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
    row_count integer NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    error text,
    source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
    snapshot_path text,
    CHECK (finished_at IS NULL OR finished_at >= started_at),
    CHECK ((status = 'running' AND finished_at IS NULL) OR (status <> 'running' AND finished_at IS NOT NULL))
);

CREATE TABLE observations (
    country_code text NOT NULL REFERENCES countries(code),
    indicator_code text NOT NULL REFERENCES indicators(code),
    period text NOT NULL CHECK (period ~ '^\d{4}(-Q[1-4]|-(0[1-9]|1[0-2]))?$'),
    value numeric,
    status text,
    dimensions jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(dimensions) = 'object'),
    source_url text NOT NULL CHECK (source_url LIKE 'https://%'),
    source_updated_at text,
    retrieved_at timestamptz NOT NULL DEFAULT now(),
    ingestion_run_id bigint NOT NULL REFERENCES ingestion_runs(id),
    PRIMARY KEY (country_code, indicator_code, period),
    CHECK (value IS NULL OR value NOT IN ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
    CHECK (indicator_code <> 'house_price_index' OR value IS NULL OR value > 0)
);

CREATE INDEX observations_indicator_period_idx ON observations (indicator_code, period, country_code);
CREATE INDEX ingestion_runs_dataset_time_idx ON ingestion_runs (dataset_code, started_at DESC);
