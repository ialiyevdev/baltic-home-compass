CREATE VIEW v_house_price_annual AS
SELECT o.country_code, o.indicator_code, left(o.period, 4) AS period,
       'A'::text AS frequency, i.unit AS source_unit, o.dimensions,
       count(o.value)::integer AS component_count, 4 AS expected_components,
       count(*) = 4 AND count(o.value) = 4 AND min(o.value) > 0
           AND NOT bool_or(position('b' IN lower(coalesce(o.status, ''))) > 0
                           AND right(o.period, 1) <> '1') AS complete,
       CASE WHEN count(*) = 4 AND count(o.value) = 4 AND min(o.value) > 0
           AND NOT bool_or(position('b' IN lower(coalesce(o.status, ''))) > 0
                           AND right(o.period, 1) <> '1')
           THEN avg(o.value) END AS value,
       array_agg(o.period ORDER BY o.period) AS source_periods,
       array_remove(array_agg(DISTINCT o.status), NULL) AS source_flags,
       bool_or(position('b' IN lower(coalesce(o.status, ''))) > 0) AS has_break,
       max(o.source_updated_at) AS source_updated_at, max(o.retrieved_at) AS retrieved_at
FROM observations o
JOIN indicators i ON i.code = o.indicator_code
JOIN ingestion_runs r ON r.id = o.ingestion_run_id AND r.status = 'success'
WHERE o.indicator_code = 'house_price_index' AND i.frequency = 'Q'
    AND o.period ~ '^[1-9]\d{3}-Q[1-4]$'
GROUP BY o.country_code, o.indicator_code, left(o.period, 4), i.unit, o.dimensions;

CREATE VIEW v_hicp_period_averages AS
WITH monthly AS (
    SELECT o.*, i.unit AS source_unit, substring(o.period, 6, 2)::integer AS month
    FROM observations o
    JOIN indicators i ON i.code = o.indicator_code
    JOIN ingestion_runs r ON r.id = o.ingestion_run_id AND r.status = 'success'
    WHERE o.indicator_code = 'hicp_index' AND i.frequency = 'M'
        AND o.period ~ '^[1-9]\d{3}-(0[1-9]|1[0-2])$'
), grouped AS (
    SELECT m.*, target.frequency, target.target_period, target.expected_components, target.first_month
    FROM monthly m
    CROSS JOIN LATERAL (VALUES
        ('A'::text, left(m.period, 4), 12, 1),
        ('Q'::text, left(m.period, 4) || '-Q' || (((m.month - 1) / 3) + 1)::text,
         3, ((m.month - 1) / 3) * 3 + 1)
    ) target(frequency, target_period, expected_components, first_month)
)
SELECT country_code, indicator_code, target_period AS period, frequency, source_unit, dimensions,
       count(value)::integer AS component_count, expected_components,
       count(*) = expected_components AND count(value) = expected_components AND min(value) > 0
           AND NOT bool_or(position('b' IN lower(coalesce(status, ''))) > 0
                           AND month <> first_month) AS complete,
       CASE WHEN count(*) = expected_components AND count(value) = expected_components AND min(value) > 0
           AND NOT bool_or(position('b' IN lower(coalesce(status, ''))) > 0
                           AND month <> first_month)
           THEN avg(value) END AS value,
       array_agg(period ORDER BY period) AS source_periods,
       array_remove(array_agg(DISTINCT status), NULL) AS source_flags,
       bool_or(position('b' IN lower(coalesce(status, ''))) > 0) AS has_break,
       max(source_updated_at) AS source_updated_at, max(retrieved_at) AS retrieved_at
FROM grouped
GROUP BY country_code, indicator_code, target_period, frequency, source_unit, dimensions, expected_components;

CREATE VIEW v_hicp_quarterly AS SELECT * FROM v_hicp_period_averages WHERE frequency = 'Q';
CREATE VIEW v_hicp_annual AS SELECT * FROM v_hicp_period_averages WHERE frequency = 'A';

CREATE VIEW v_observation_year_over_year AS
WITH indexed AS (
    SELECT o.country_code, o.indicator_code, o.period, o.value, o.status, i.frequency,
           CASE i.frequency WHEN 'A' THEN 1 WHEN 'Q' THEN 4 ELSE 12 END AS periods_per_year,
           left(o.period, 4)::integer * CASE i.frequency WHEN 'A' THEN 1 WHEN 'Q' THEN 4 ELSE 12 END
               + CASE i.frequency WHEN 'A' THEN 0 WHEN 'Q' THEN right(o.period, 1)::integer - 1
                    ELSE right(o.period, 2)::integer - 1 END AS ordinal
    FROM observations o
    JOIN indicators i ON i.code = o.indicator_code
    JOIN ingestion_runs r ON r.id = o.ingestion_run_id AND r.status = 'success'
    WHERE (i.frequency = 'A' AND o.period ~ '^[1-9]\d{3}$')
       OR (i.frequency = 'Q' AND o.period ~ '^[1-9]\d{3}-Q[1-4]$')
       OR (i.frequency = 'M' AND o.period ~ '^[1-9]\d{3}-(0[1-9]|1[0-2])$')
), spans AS (
    SELECT country_code, indicator_code, frequency, periods_per_year,
           min(ordinal) AS first_ordinal, max(ordinal) AS last_ordinal
    FROM indexed GROUP BY country_code, indicator_code, frequency, periods_per_year
), dense AS (
    SELECT s.*, g.ordinal, i.period, i.value, i.status,
           count(*) FILTER (WHERE position('b' IN lower(coalesce(i.status, ''))) > 0)
               OVER (PARTITION BY s.country_code, s.indicator_code ORDER BY g.ordinal) AS break_count
    FROM spans s
    CROSS JOIN LATERAL generate_series(s.first_ordinal, s.last_ordinal) g(ordinal)
    LEFT JOIN indexed i ON i.country_code = s.country_code AND i.indicator_code = s.indicator_code
        AND i.ordinal = g.ordinal
), previous AS (
    SELECT *, lag(value, periods_per_year) OVER series AS previous_value,
              lag(period, periods_per_year) OVER series AS previous_period,
              lag(break_count, periods_per_year) OVER series AS previous_break_count
    FROM dense WINDOW series AS (PARTITION BY country_code, indicator_code ORDER BY ordinal)
)
SELECT country_code, indicator_code, period, frequency, value, status, previous_period, previous_value,
       CASE WHEN value IS NOT NULL AND previous_value > 0 AND break_count = previous_break_count
           AND indicator_code IN ('house_price_index', 'annual_net_earnings', 'hicp_index',
               'median_equivalised_income', 'household_consumption_expenditure',
               'household_consumption_volume', 'household_price_level', 'rent_price_index')
           THEN 100 * (value / previous_value - 1) END AS year_over_year_percent,
       CASE WHEN value IS NOT NULL AND previous_value IS NOT NULL AND break_count = previous_break_count
           AND indicator_code IN ('hicp_annual_change', 'housing_cost_overburden', 'mortgage_borrowing_rate')
           THEN value - previous_value END AS year_over_year_percentage_points
FROM previous WHERE period IS NOT NULL;
