ALTER TABLE indicators
    ADD COLUMN status_labels jsonb NOT NULL DEFAULT '{}'
        CHECK (jsonb_typeof(status_labels) = 'object');

ALTER TABLE ingestion_runs
    ADD COLUMN indicator_code text REFERENCES indicators(code);

UPDATE ingestion_runs AS runs
SET indicator_code = 'house_price_index'
WHERE runs.dataset_code = (
    SELECT dataset_code FROM indicators WHERE code = 'house_price_index'
);

CREATE INDEX ingestion_runs_indicator_time_idx
    ON ingestion_runs (indicator_code, started_at DESC);
