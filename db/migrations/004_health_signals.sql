-- Early warning from his own WHOOP data.
-- Compares the last 3 days of HRV, resting HR, respiratory rate, and skin temperature
-- against his own 30-day baseline. Two or more markers off on consecutive days often
-- shows up before he feels run down or sick. A signal, not a diagnosis.

INSERT OR IGNORE INTO metric_defs (key, label, unit, domain_id, description) VALUES
('respiratory_rate', 'Respiratory rate', 'breaths/min', 3, 'Average breathing rate during sleep (WHOOP)'),
('skin_temp_c',      'Skin temperature', '°C',          3, 'Skin temperature during sleep (WHOOP 4.0+)');

-- One row per marker per recent day. off_baseline: 1 = moved in the worrying direction by more than
-- one standard deviation of his own baseline (and by a minimum real-world amount), 0 = normal,
-- NULL = not enough baseline yet (under 14 days). The baseline excludes the recent days themselves.
CREATE VIEW IF NOT EXISTS v_health_signals AS
WITH daily AS (
  SELECT measured_on AS d, metric_key AS k, AVG(value) AS v
  FROM metrics
  WHERE metric_key IN ('whoop_hrv','resting_hr','respiratory_rate','skin_temp_c')
  GROUP BY measured_on, metric_key
),
base AS (
  SELECT k, AVG(v) AS mean, AVG(v*v) - AVG(v)*AVG(v) AS var, COUNT(*) AS n
  FROM daily
  WHERE d <= date('now','localtime','-3 days') AND d > date('now','localtime','-33 days')
  GROUP BY k
)
SELECT r.d AS measured_on, r.k AS metric_key, ROUND(r.v, 1) AS value,
       ROUND(b.mean, 1) AS baseline, b.n AS baseline_days,
       ROUND(r.v - b.mean, 1) AS change,
       CASE
         WHEN b.n < 14 OR b.var <= 0 THEN NULL
         WHEN r.k = 'whoop_hrv'        AND r.v < b.mean AND (r.v-b.mean)*(r.v-b.mean) > b.var AND b.mean - r.v >= 5   THEN 1
         WHEN r.k = 'resting_hr'       AND r.v > b.mean AND (r.v-b.mean)*(r.v-b.mean) > b.var AND r.v - b.mean >= 2   THEN 1
         WHEN r.k = 'respiratory_rate' AND r.v > b.mean AND (r.v-b.mean)*(r.v-b.mean) > b.var AND r.v - b.mean >= 0.5 THEN 1
         WHEN r.k = 'skin_temp_c'      AND r.v > b.mean AND (r.v-b.mean)*(r.v-b.mean) > b.var AND r.v - b.mean >= 0.3 THEN 1
         ELSE 0
       END AS off_baseline
FROM daily r
JOIN base b ON b.k = r.k
WHERE r.d > date('now','localtime','-3 days');

-- One row per recent day: how many markers are off, and which.
CREATE VIEW IF NOT EXISTS v_health_flags AS
SELECT measured_on,
       SUM(off_baseline) AS markers_off,
       COUNT(off_baseline) AS markers_checked,
       GROUP_CONCAT(CASE WHEN off_baseline = 1 THEN metric_key END) AS which
FROM v_health_signals
GROUP BY measured_on
ORDER BY measured_on DESC;
