-- Migration 002: the five improvement loops.
-- 1. Health experiments   2. Meal planning   3. Decision journal
-- 4. Daily focus          5. Agent self-improvement
-- Safe to run on an existing database: only adds tables, views, and starter rows.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version     TEXT PRIMARY KEY,
  applied_at  TEXT DEFAULT (datetime('now','localtime'))
);

-- ---------- Shared helper: one value per metric per day ----------
-- Additive metrics (food, minutes) are summed; readings (recovery, HRV, weight) are averaged.
CREATE VIEW IF NOT EXISTS v_daily_metrics AS
SELECT measured_on, metric_key,
       CASE WHEN metric_key IN ('calories_in','protein_g','carbs_g','fat_g','workout_minutes','learning_minutes')
            THEN SUM(value) ELSE AVG(value) END AS value
FROM metrics
GROUP BY measured_on, metric_key;

-- =====================================================================
-- LOOP 1: Health experiments (one change at a time, judged on his own data)
-- =====================================================================
CREATE TABLE IF NOT EXISTS experiments (
  id               INTEGER PRIMARY KEY,
  domain_id        INTEGER REFERENCES domains(id),
  title            TEXT NOT NULL,
  hypothesis       TEXT,            -- "If I X, then Y will improve"
  intervention     TEXT NOT NULL,   -- exactly what he does each day
  metric_key       TEXT REFERENCES metric_defs(key),  -- the primary outcome
  better_direction TEXT CHECK (better_direction IN ('up','down')),
  duration_days    INTEGER NOT NULL DEFAULT 14,
  status           TEXT NOT NULL DEFAULT 'proposed'
                   CHECK (status IN ('proposed','running','evaluating','kept','dropped','abandoned')),
  start_date       TEXT,
  end_date         TEXT,
  baseline_value   REAL,            -- avg of metric over the 14 days before start
  result_value     REAL,            -- avg of metric during the experiment
  adherence_pct    REAL,
  verdict          TEXT,            -- plain-language conclusion, including caveats
  created_at       TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS experiment_checkins (
  experiment_id  INTEGER REFERENCES experiments(id),
  checkin_date   TEXT NOT NULL,     -- YYYY-MM-DD
  adhered        INTEGER NOT NULL CHECK (adhered IN (0,1)),
  note           TEXT,
  PRIMARY KEY (experiment_id, checkin_date)
);

-- Live view of running/evaluating experiments with baseline vs current.
CREATE VIEW IF NOT EXISTS v_experiments_active AS
SELECT e.id, e.title, e.intervention, e.metric_key, e.better_direction, e.status,
       e.start_date, e.duration_days,
       CAST(julianday(date('now','localtime')) - julianday(e.start_date) AS INTEGER) + 1 AS day_number,
       (SELECT ROUND(AVG(d.value),1) FROM v_daily_metrics d
         WHERE d.metric_key = e.metric_key
           AND d.measured_on >= date(e.start_date,'-14 days') AND d.measured_on < e.start_date) AS baseline_avg,
       (SELECT COUNT(*) FROM v_daily_metrics d
         WHERE d.metric_key = e.metric_key
           AND d.measured_on >= date(e.start_date,'-14 days') AND d.measured_on < e.start_date) AS baseline_days,
       (SELECT ROUND(AVG(d.value),1) FROM v_daily_metrics d
         WHERE d.metric_key = e.metric_key
           AND d.measured_on >= e.start_date AND d.measured_on <= COALESCE(e.end_date, date('now','localtime'))) AS current_avg,
       (SELECT COUNT(*) FROM v_daily_metrics d
         WHERE d.metric_key = e.metric_key
           AND d.measured_on >= e.start_date AND d.measured_on <= COALESCE(e.end_date, date('now','localtime'))) AS current_days,
       (SELECT ROUND(100.0 * SUM(c.adhered) / COUNT(*)) FROM experiment_checkins c WHERE c.experiment_id = e.id) AS adherence_pct,
       (SELECT COUNT(*) FROM experiment_checkins c WHERE c.experiment_id = e.id) AS checkins
FROM experiments e
WHERE e.status IN ('running','evaluating');

-- =====================================================================
-- LOOP 2: Meal planning (his meals; dinners are shared with his wife)
-- =====================================================================
CREATE TABLE IF NOT EXISTS meal_plan (
  id          INTEGER PRIMARY KEY,
  week_start  TEXT NOT NULL,        -- the Sunday the plan week starts, YYYY-MM-DD
  plan_date   TEXT NOT NULL,        -- YYYY-MM-DD
  meal        TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snack')),
  description TEXT NOT NULL,
  shared      INTEGER NOT NULL DEFAULT 0,   -- 1 = dinner for both of them
  calories    REAL,                 -- his portion, estimated
  protein_g   REAL,
  carbs_g     REAL,
  fat_g       REAL,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','eaten','swapped','skipped')),
  notes       TEXT
);
CREATE INDEX IF NOT EXISTS idx_meal_plan_date ON meal_plan(plan_date);

CREATE TABLE IF NOT EXISTS grocery_items (
  id          INTEGER PRIMARY KEY,
  week_start  TEXT NOT NULL,
  item        TEXT NOT NULL,
  quantity    TEXT,
  category    TEXT,                 -- produce, protein, dairy, pantry, frozen, other
  checked     INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT DEFAULT (datetime('now','localtime'))
);

CREATE VIEW IF NOT EXISTS v_meal_plan_week AS
SELECT plan_date, meal, description, shared, calories, protein_g, status
FROM meal_plan
WHERE plan_date >= date('now','localtime','weekday 0','-7 days')
  AND plan_date <  date('now','localtime','weekday 0','-7 days','+7 days')
ORDER BY plan_date, CASE meal WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END;

CREATE VIEW IF NOT EXISTS v_meal_plan_daily_totals AS
SELECT plan_date, ROUND(SUM(calories)) AS planned_calories, ROUND(SUM(protein_g)) AS planned_protein
FROM meal_plan WHERE status <> 'skipped'
GROUP BY plan_date;

CREATE VIEW IF NOT EXISTS v_grocery_open AS
SELECT id, item, quantity, category FROM grocery_items
WHERE checked = 0
ORDER BY category, item;

-- =====================================================================
-- LOOP 3: Decision journal (predict, then check)
-- =====================================================================
CREATE TABLE IF NOT EXISTS decisions (
  id                INTEGER PRIMARY KEY,
  domain_id         INTEGER REFERENCES domains(id),
  thread_id         INTEGER REFERENCES threads(id),
  title             TEXT NOT NULL,
  options           TEXT,           -- what he considered
  choice            TEXT,           -- what he decided
  reasoning         TEXT,           -- why, in his words
  expected_outcome  TEXT,           -- what he predicts will happen
  confidence        INTEGER CHECK (confidence BETWEEN 0 AND 100),
  decided_on        TEXT DEFAULT (date('now','localtime')),
  review_on         TEXT,           -- when to check back (default ~3 months)
  status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed')),
  actual_outcome    TEXT,
  outcome_vs_expected TEXT CHECK (outcome_vs_expected IN ('better','as_expected','worse','mixed')),
  lessons           TEXT,
  reviewed_on       TEXT
);

CREATE VIEW IF NOT EXISTS v_decisions_due AS
SELECT id, title, choice, expected_outcome, confidence, decided_on, review_on
FROM decisions
WHERE status = 'open' AND review_on IS NOT NULL AND review_on <= date('now','localtime')
ORDER BY review_on;

-- Calibration: are his 80%-confident calls right ~80% of the time?
CREATE VIEW IF NOT EXISTS v_decision_calibration AS
SELECT CASE WHEN confidence < 50 THEN 'under 50%'
            WHEN confidence < 70 THEN '50-69%'
            WHEN confidence < 85 THEN '70-84%'
            ELSE '85%+' END AS confidence_band,
       COUNT(*) AS reviewed,
       SUM(CASE WHEN outcome_vs_expected IN ('better','as_expected') THEN 1 ELSE 0 END) AS went_as_expected_or_better
FROM decisions
WHERE status = 'reviewed' AND confidence IS NOT NULL
GROUP BY confidence_band;

-- =====================================================================
-- LOOP 4: Daily focus (the one thing, and whether it got done)
-- =====================================================================
CREATE TABLE IF NOT EXISTS daily_focus (
  focus_date  TEXT PRIMARY KEY,     -- YYYY-MM-DD
  focus       TEXT NOT NULL,
  thread_id   INTEGER REFERENCES threads(id),
  done        INTEGER CHECK (done IN (0,1)),   -- NULL until he says
  note        TEXT
);

CREATE VIEW IF NOT EXISTS v_focus_hit_rate AS
SELECT
  SUM(CASE WHEN focus_date > date('now','localtime','-7 days')  AND done = 1 THEN 1 ELSE 0 END) AS done_7d,
  SUM(CASE WHEN focus_date > date('now','localtime','-7 days')  AND done IS NOT NULL THEN 1 ELSE 0 END) AS answered_7d,
  SUM(CASE WHEN focus_date > date('now','localtime','-28 days') AND done = 1 THEN 1 ELSE 0 END) AS done_28d,
  SUM(CASE WHEN focus_date > date('now','localtime','-28 days') AND done IS NOT NULL THEN 1 ELSE 0 END) AS answered_28d
FROM daily_focus;

-- =====================================================================
-- LOOP 5: Agent self-improvement (measure what's used, propose changes)
-- =====================================================================
CREATE TABLE IF NOT EXISTS routine_runs (
  id            INTEGER PRIMARY KEY,
  routine       TEXT NOT NULL,      -- morning-brief, evening-checkin, weekly-review, meal-plan
  sent_at       TEXT DEFAULT (datetime('now','localtime')),
  responded     INTEGER NOT NULL DEFAULT 0,  -- set to 1 when he replies to or acts on it
  responded_at  TEXT,
  note          TEXT
);

CREATE TABLE IF NOT EXISTS agent_feedback (
  id           INTEGER PRIMARY KEY,
  occurred_at  TEXT DEFAULT (datetime('now','localtime')),
  kind         TEXT CHECK (kind IN ('correction','complaint','praise','ignored','request')),
  about        TEXT,                -- which behavior or routine
  detail       TEXT NOT NULL        -- what he said, close to his words
);

CREATE TABLE IF NOT EXISTS agent_changes (
  id           INTEGER PRIMARY KEY,
  proposed_at  TEXT DEFAULT (datetime('now','localtime')),
  change       TEXT NOT NULL,       -- the exact rule to add to/remove from playbook.md
  reason       TEXT NOT NULL,       -- the evidence behind it
  status       TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  decided_at   TEXT
);

CREATE VIEW IF NOT EXISTS v_routine_engagement AS
SELECT routine,
       COUNT(*) AS sent_28d,
       SUM(responded) AS responded_28d,
       ROUND(100.0 * SUM(responded) / COUNT(*)) AS response_pct
FROM routine_runs
WHERE sent_at > datetime('now','localtime','-28 days')
GROUP BY routine;

-- =====================================================================
-- Starter data
-- =====================================================================

-- Fill in the nutrition targets he has stated (2,200 kcal, 200 g protein during the cut).
UPDATE goals SET target_value = 200 WHERE metric_key = 'protein_g' AND target_value IS NULL;
INSERT INTO goals (domain_id, title, why, metric_key, target_value, direction)
SELECT 3, 'Daily calories during the cut', 'Cut phase target', 'calories_in', 2200, 'hold'
WHERE NOT EXISTS (SELECT 1 FROM goals WHERE metric_key = 'calories_in');

-- A few proposed experiments to choose from. He picks one; only one runs at a time.
INSERT INTO experiments (domain_id, title, hypothesis, intervention, metric_key, better_direction, duration_days, status)
SELECT 3, 'Consistent bedtime',
       'A fixed lights-out time will raise average recovery.',
       'Lights out within 15 minutes of the same time every night, including weekends.',
       'whoop_recovery', 'up', 14, 'proposed'
WHERE NOT EXISTS (SELECT 1 FROM experiments WHERE title = 'Consistent bedtime');

INSERT INTO experiments (domain_id, title, hypothesis, intervention, metric_key, better_direction, duration_days, status)
SELECT 3, 'Caffeine cutoff at noon',
       'No caffeine after 12pm will improve sleep performance.',
       'No coffee, pre-workout, or other caffeine after 12:00pm.',
       'whoop_sleep_perf', 'up', 14, 'proposed'
WHERE NOT EXISTS (SELECT 1 FROM experiments WHERE title = 'Caffeine cutoff at noon');

INSERT INTO experiments (domain_id, title, hypothesis, intervention, metric_key, better_direction, duration_days, status)
SELECT 3, '40g protein breakfast',
       'Front-loading protein makes the 200g daily target easier to hit.',
       'Breakfast with at least 40g of protein every day.',
       'protein_g', 'up', 14, 'proposed'
WHERE NOT EXISTS (SELECT 1 FROM experiments WHERE title = '40g protein breakfast');

-- The life insurance decision is a natural first decision-journal entry; he fills in the rest when he decides.
INSERT INTO decisions (domain_id, thread_id, title, options, status)
SELECT 6, (SELECT id FROM threads WHERE title LIKE 'Life insurance policy%' LIMIT 1),
       'Keep or unwind the cash-value life insurance policy',
       'Keep the policy; or cancel it, redirect the premium to 401(k)/IRA/HSA, and buy term coverage',
       'open'
WHERE NOT EXISTS (SELECT 1 FROM decisions WHERE title LIKE 'Keep or unwind%');

UPDATE decisions SET review_on = NULL WHERE choice IS NULL;  -- not decided yet, so nothing to review

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('002_loops');
