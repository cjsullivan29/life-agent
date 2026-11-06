-- Migration 006: training blocks, daily targets, check-ins by exception, learned maintenance, skinfolds.
-- The goal dials live in training_blocks. Every rule the agent follows reads the active block,
-- so the same morning can call for different answers in a cut and in a HYROX block (coaching.md section 1).
-- Safe to run on an existing database: only adds tables, columns, views, and starter rows.
PRAGMA foreign_keys = ON;

-- ---------- The dials, one row per training block ----------
CREATE TABLE IF NOT EXISTS training_blocks (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,                       -- e.g. "Cut, part 2"
  phase               TEXT NOT NULL DEFAULT 'cut'
                      CHECK (phase IN ('cut','build','hyrox_block','taper','maintenance','other')),
  start_date          TEXT NOT NULL,                       -- YYYY-MM-DD
  end_date            TEXT,                                -- NULL = open-ended
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('planned','active','done')),
  priority            INTEGER NOT NULL DEFAULT 20 CHECK (priority BETWEEN 0 AND 100),   -- 0 = body comp, 100 = performance
  direction           TEXT NOT NULL DEFAULT 'lose' CHECK (direction IN ('lose','maintain','gain')),
  rate_pct            REAL NOT NULL DEFAULT 0.5 CHECK (rate_pct BETWEEN 0 AND 1),       -- % of body weight per week
  emphasis            INTEGER NOT NULL DEFAULT 50 CHECK (emphasis BETWEEN 0 AND 100),   -- 0 = strength, 100 = engine
  recovery_strictness TEXT NOT NULL DEFAULT 'balanced' CHECK (recovery_strictness IN ('conservative','balanced','aggressive')),
  sessions_per_week   INTEGER NOT NULL DEFAULT 5 CHECK (sessions_per_week BETWEEN 1 AND 7),
  maintenance_kcal    REAL,                                -- his starting guess; replaced by the learned estimate once it's ready
  calorie_floor       REAL NOT NULL DEFAULT 1800,          -- coaching.md section 12
  notes               TEXT,
  created_at          TEXT DEFAULT (datetime('now','localtime')),
  updated_at          TEXT DEFAULT (datetime('now','localtime')),
  CHECK (direction <> 'gain' OR rate_pct <= 0.5),
  CHECK (end_date IS NULL OR end_date >= start_date)
);

-- ---------- The algorithm's changelog: change one rule at a time ----------
CREATE TABLE IF NOT EXISTS rules_versions (
  version         TEXT PRIMARY KEY,
  effective_date  TEXT NOT NULL,
  change          TEXT NOT NULL,
  reason          TEXT,
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);
INSERT OR IGNORE INTO rules_versions (version, effective_date, change, reason) VALUES
('1.0', date('now','localtime'),
 'Skeleton rules v1: calories = maintenance + direction x rate x weight x 3500 / 7; hard/rest spread 100-400 kcal by priority, weekly average holds; protein 0.8-1.2 g/lb by cut rate; fat floor 25% of calories or 0.3 g/lb; carbs fill the rest; recovery gates by strictness.',
 'Starting point from the v1 build spec');

-- ---------- What the agent set each day ----------
CREATE TABLE IF NOT EXISTS daily_targets (
  target_date     TEXT PRIMARY KEY,                        -- YYYY-MM-DD
  block_id        INTEGER REFERENCES training_blocks(id),
  day_type        TEXT CHECK (day_type IN ('hard','moderate','rest')),
  kcal            REAL,
  protein_g       REAL,
  carbs_g         REAL,
  fat_g           REAL,
  recovery        REAL,                                    -- that morning's recovery, if scored
  gate            TEXT CHECK (gate IN ('as_planned','scaled','swapped','rest')),
  session_change  TEXT,                                    -- what changed in today's session and why, one line
  rules_version   TEXT REFERENCES rules_versions(version),
  note            TEXT,
  created_at      TEXT DEFAULT (datetime('now','localtime'))
);

-- ---------- Check-ins by exception ----------
-- A planned session lists the few things worth asking about afterwards. JSON array, e.g.
-- [{"measure":"1k pace","target":250,"unit":"s/km"},{"measure":"back squat top set","target":5,"unit":"reps @ 275 lb"}]
ALTER TABLE planned_sessions ADD COLUMN key_measures TEXT;
ALTER TABLE planned_sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'agent';   -- agent, upload (his program, a screenshot), override (he changed it)
ALTER TABLE planned_sessions ADD COLUMN block_id INTEGER REFERENCES training_blocks(id);

-- How the session went, from the check-in. Anything he doesn't report counts as done as prescribed.
ALTER TABLE workouts ADD COLUMN checkin_status TEXT;   -- as_written, modified, skipped, unplanned
ALTER TABLE workouts ADD COLUMN checkin_at TEXT;

CREATE TABLE IF NOT EXISTS session_measures (
  id                  INTEGER PRIMARY KEY,
  workout_id          INTEGER REFERENCES workouts(id),
  planned_session_id  INTEGER REFERENCES planned_sessions(id),
  measure_date        TEXT NOT NULL,
  measure             TEXT NOT NULL,                       -- same wording as the key measure
  target              REAL,
  actual              REAL,                                -- NULL = he didn't say; as_written means it matched the target
  unit                TEXT,
  note                TEXT,
  logged_at           TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_measures ON session_measures(measure, measure_date);

-- ---------- Skinfolds: weekly, same sites, same conditions ----------
INSERT OR IGNORE INTO metric_defs (key, label, unit, domain_id, description) VALUES
('skinfold_chest',        'Skinfold: chest',        'mm', 3, 'Weekly caliper reading'),
('skinfold_abdomen',      'Skinfold: abdomen',      'mm', 3, 'Weekly caliper reading'),
('skinfold_thigh',        'Skinfold: thigh',        'mm', 3, 'Weekly caliper reading'),
('skinfold_triceps',      'Skinfold: triceps',      'mm', 3, 'Weekly caliper reading'),
('skinfold_suprailiac',   'Skinfold: suprailiac',   'mm', 3, 'Weekly caliper reading'),
('skinfold_subscapular',  'Skinfold: subscapular',  'mm', 3, 'Weekly caliper reading'),
('skinfold_midaxillary',  'Skinfold: midaxillary',  'mm', 3, 'Weekly caliper reading');

-- The sum is the trend; no body-fat equation (the equations add their own error).
CREATE VIEW IF NOT EXISTS v_skinfold_sums AS
SELECT measured_on, ROUND(SUM(value), 1) AS sum_mm, COUNT(*) AS sites,
       GROUP_CONCAT(REPLACE(metric_key, 'skinfold_', '') || ' ' || value, ', ') AS detail
FROM v_daily_metrics
WHERE metric_key LIKE 'skinfold\_%' ESCAPE '\'
GROUP BY measured_on
ORDER BY measured_on;

-- ---------- The active block ----------
CREATE VIEW IF NOT EXISTS v_active_block AS
SELECT * FROM training_blocks
WHERE status = 'active'
  AND start_date <= date('now','localtime')
  AND (end_date IS NULL OR end_date >= date('now','localtime'))
ORDER BY start_date DESC, id DESC
LIMIT 1;

-- ---------- Learned maintenance ----------
-- Energy balance over the last 21 finished days: average logged intake, corrected by how the
-- weight trend moved (first week's average vs last week's, 14 days apart, ~3,500 kcal per lb).
-- Only "ready" with 14+ logged days and 3+ weigh-ins at each end. Under-logging biases it low.
CREATE VIEW IF NOT EXISTS v_maintenance_estimate AS
WITH w AS (
  SELECT
    (SELECT COUNT(*) FROM v_daily_metrics WHERE metric_key = 'calories_in'
       AND measured_on >= date('now','localtime','-21 days') AND measured_on < date('now','localtime')) AS intake_days,
    (SELECT AVG(value) FROM v_daily_metrics WHERE metric_key = 'calories_in'
       AND measured_on >= date('now','localtime','-21 days') AND measured_on < date('now','localtime')) AS avg_intake,
    (SELECT AVG(value) FROM v_daily_metrics WHERE metric_key = 'body_weight'
       AND measured_on >= date('now','localtime','-21 days') AND measured_on < date('now','localtime','-14 days')) AS w_early,
    (SELECT COUNT(*) FROM v_daily_metrics WHERE metric_key = 'body_weight'
       AND measured_on >= date('now','localtime','-21 days') AND measured_on < date('now','localtime','-14 days')) AS n_early,
    (SELECT AVG(value) FROM v_daily_metrics WHERE metric_key = 'body_weight'
       AND measured_on >= date('now','localtime','-7 days') AND measured_on < date('now','localtime')) AS w_late,
    (SELECT COUNT(*) FROM v_daily_metrics WHERE metric_key = 'body_weight'
       AND measured_on >= date('now','localtime','-7 days') AND measured_on < date('now','localtime')) AS n_late
)
SELECT intake_days, ROUND(avg_intake) AS avg_intake,
       ROUND(w_early, 1) AS weight_early, ROUND(w_late, 1) AS weight_late,
       ROUND((w_late - w_early) / 2.0, 2) AS lb_per_week,
       CASE WHEN intake_days >= 14 AND n_early >= 3 AND n_late >= 3
            THEN ROUND((avg_intake + (w_early - w_late) * 3500.0 / 14) / 10) * 10 END AS estimate_kcal,
       CASE WHEN intake_days >= 14 AND n_early >= 3 AND n_late >= 3 THEN 1 ELSE 0 END AS ready
FROM w;

-- ---------- The skeleton: what the dials produce today ----------
-- One place for the math, so the agent and the dashboard always agree.
-- Weekly average of hard and rest days equals the target.
CREATE VIEW IF NOT EXISTS v_block_skeleton AS
WITH b AS (SELECT * FROM v_active_block),
wt AS (
  SELECT AVG(value) AS weight FROM v_daily_metrics
  WHERE metric_key = 'body_weight' AND measured_on > date('now','localtime','-7 days')
),
m AS (SELECT estimate_kcal, ready FROM v_maintenance_estimate),
base AS (
  SELECT b.*, ROUND(wt.weight, 1) AS weight_avg7,
         CASE WHEN m.ready = 1 THEN m.estimate_kcal ELSE b.maintenance_kcal END AS maintenance_used,
         CASE WHEN m.ready = 1 THEN 'learned' WHEN b.maintenance_kcal IS NOT NULL THEN 'manual' END AS maintenance_source,
         CASE b.direction WHEN 'lose' THEN -1 WHEN 'gain' THEN 1 ELSE 0 END * b.rate_pct / 100.0 * wt.weight * 3500 / 7 AS delta,
         100 + 3 * b.priority AS spread
  FROM b, wt, m
),
t AS (
  SELECT base.*, ROUND((maintenance_used + delta) / 10) * 10 AS kcal_target,
         ROUND(weight_avg7 * CASE WHEN direction = 'lose' THEN 0.8 + 0.4 * MIN(rate_pct, 1) ELSE 0.8 END) AS protein_g
  FROM base
),
d AS (
  SELECT t.*,
         ROUND((kcal_target + spread * (7 - sessions_per_week) / 7.0) / 10) * 10 AS hard_kcal,
         ROUND((kcal_target - spread * sessions_per_week / 7.0) / 10) * 10 AS rest_kcal,
         ROUND(MAX(kcal_target * 0.25 / 9, weight_avg7 * 0.3)) AS fat_g
  FROM t
)
SELECT id AS block_id, name, phase, priority, direction, rate_pct, emphasis, recovery_strictness, sessions_per_week,
       weight_avg7, maintenance_used, maintenance_source, ROUND(delta) AS daily_delta, spread,
       kcal_target, hard_kcal, rest_kcal, protein_g, fat_g,
       ROUND((hard_kcal - protein_g * 4 - fat_g * 9) / 4) AS hard_carbs_g,
       ROUND((rest_kcal - protein_g * 4 - fat_g * 9) / 4) AS rest_carbs_g,
       CAST(MAX(1, MIN(sessions_per_week - 1, ROUND(sessions_per_week * (100 - emphasis) / 100.0))) AS INTEGER) AS strength_sessions,
       calorie_floor
FROM d;

-- ---------- Conflicts, checked when the dials are set ----------
CREATE VIEW IF NOT EXISTS v_block_conflicts AS
SELECT 'warning' AS level, 'A fast cut and a performance priority pull against each other. Expect benchmarks to stall.' AS message
  FROM v_active_block WHERE direction = 'lose' AND rate_pct > 0.75 AND priority > 55
UNION ALL
SELECT 'warning', 'Losing faster than about 0.75% a week raises the risk of losing muscle. Protein floor is raised to compensate.'
  FROM v_active_block WHERE direction = 'lose' AND rate_pct > 0.75
UNION ALL
SELECT 'warning', 'Gaining with an engine-heavy week: conditioning volume eats into the surplus.'
  FROM v_active_block WHERE direction = 'gain' AND priority < 40 AND emphasis > 60
UNION ALL
SELECT 'critical', 'Aggressive recovery tolerance during a meaningful deficit is the most common route to a stalled cut or a niggle.'
  FROM v_active_block WHERE recovery_strictness = 'aggressive' AND direction = 'lose' AND rate_pct > 0.6
UNION ALL
SELECT 'critical', 'Rest-day calories fall below the calorie floor (' || CAST(calorie_floor AS INTEGER) || '). Slow the rate or raise maintenance.'
  FROM v_block_skeleton WHERE rest_kcal < calorie_floor
UNION ALL
SELECT 'info', 'No maintenance number yet. Enter a starting guess; it gets replaced by a learned estimate after 2-3 weeks of logging.'
  FROM v_block_skeleton WHERE maintenance_used IS NULL
UNION ALL
SELECT 'info', 'No weigh-ins in the last 7 days, so calorie and protein targets can''t be computed.'
  FROM v_block_skeleton WHERE weight_avg7 IS NULL;

-- ---------- Training load: session RPE x minutes, next to WHOOP strain ----------
CREATE VIEW IF NOT EXISTS v_session_load AS
SELECT w.id, w.workout_date, w.sport, w.session_type, ROUND(w.duration_min) AS duration_min,
       w.rpe, ROUND(w.rpe * w.duration_min) AS srpe_load, w.strain, w.checkin_status,
       ps.title AS planned_title,
       (SELECT COUNT(*) FROM session_measures sm WHERE sm.workout_id = w.id) AS measures_logged
FROM workouts w LEFT JOIN planned_sessions ps ON ps.id = w.planned_session_id
WHERE w.workout_date >= date('now','localtime','-28 days')
ORDER BY w.workout_date DESC, w.start_at DESC;

-- Workouts that still need a check-in (today and yesterday only; older ones are let go).
CREATE VIEW IF NOT EXISTS v_checkins_due AS
SELECT w.id, w.workout_date, w.start_at, w.sport, ROUND(w.duration_min) AS duration_min, w.strain,
       ps.id AS planned_session_id, ps.title AS planned_title, ps.intent, ps.key_measures
FROM workouts w LEFT JOIN planned_sessions ps ON ps.id = w.planned_session_id
WHERE w.checkin_status IS NULL AND w.workout_date >= date('now','localtime','-1 day')
ORDER BY w.start_at;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('006_training_blocks');
