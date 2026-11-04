-- Workouts: what he did (WHOOP), what he lifted (texted in), and what was planned.
-- The agent judges each session against its intent (knowledge/coaching.md, section 8).

-- One row per WHOOP workout. The sync upserts by whoop_id; the agent fills the last block.
CREATE TABLE IF NOT EXISTS workouts (
  id                 INTEGER PRIMARY KEY,
  whoop_id           TEXT UNIQUE,              -- NULL for workouts he logs without the strap
  workout_date       TEXT NOT NULL,            -- local YYYY-MM-DD
  start_at           TEXT,                     -- local time, YYYY-MM-DD HH:MM
  end_at             TEXT,
  sport              TEXT,                     -- WHOOP sport name (e.g. running, weightlifting, functional-fitness)
  duration_min       REAL,
  strain             REAL,                     -- workout strain, 0-21
  avg_hr             INTEGER,
  max_hr             INTEGER,
  kcal               REAL,
  distance_m         REAL,
  percent_recorded   REAL,                     -- under ~80 means the strap missed data; don't judge the numbers
  z0_min REAL, z1_min REAL, z2_min REAL, z3_min REAL, z4_min REAL, z5_min REAL,  -- minutes in WHOOP HR zones
  source             TEXT DEFAULT 'whoop_api', -- whoop_api, manual
  synced_at          TEXT DEFAULT (datetime('now','localtime')),
  -- Filled by the agent:
  session_type       TEXT CHECK (session_type IN ('strength','zone2','intervals','threshold','hyrox_sim','race','mixed','mobility','sport','other')),
  planned_session_id INTEGER REFERENCES planned_sessions(id),
  rpe                REAL,                     -- his rating, 1-10
  notes              TEXT,                     -- what he said about it
  verdict            TEXT,                     -- the agent's one-to-two-line read
  reviewed_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);

-- Sets he texts in ("squat 5x5 at 275, RPE 8"). One row per set, or per block of identical sets.
CREATE TABLE IF NOT EXISTS workout_sets (
  id          INTEGER PRIMARY KEY,
  workout_id  INTEGER REFERENCES workouts(id),  -- link to the WHOOP session when it exists
  log_date    TEXT NOT NULL,
  exercise    TEXT NOT NULL,
  sets        INTEGER DEFAULT 1,
  reps        INTEGER,
  load_lb     REAL,
  rpe         REAL,
  distance_m  REAL,                             -- for runs, rows, sleds, carries
  time_sec    REAL,
  notes       TEXT,
  logged_at   TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sets_exercise ON workout_sets(exercise, log_date);

-- The training plan, one row per session. Filled from his program tracker.
CREATE TABLE IF NOT EXISTS planned_sessions (
  id            INTEGER PRIMARY KEY,
  plan_date     TEXT NOT NULL,
  phase         TEXT,                           -- cut, hyrox_block, taper, maintenance
  session_type  TEXT,                           -- same values as workouts.session_type
  title         TEXT NOT NULL,
  intent        TEXT,                           -- what it's for, e.g. "Zone 2, 45 min, HR under 145"
  details       TEXT,                           -- the prescription
  key_session   INTEGER NOT NULL DEFAULT 0,     -- 1 = protect this one
  status        TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','done','modified','swapped','skipped')),
  workout_id    INTEGER REFERENCES workouts(id)
);
CREATE INDEX IF NOT EXISTS idx_planned_date ON planned_sessions(plan_date);

-- Recent workouts with context for judging them: that morning's recovery, how strain compares
-- with his typical session of the same kind over the prior 60 days, and the zone split.
CREATE VIEW IF NOT EXISTS v_workout_review AS
SELECT w.id, w.workout_date, w.start_at, w.sport, w.session_type,
       ROUND(w.duration_min) AS duration_min, w.strain, w.avg_hr, w.max_hr, w.percent_recorded,
       (SELECT ROUND(AVG(value)) FROM metrics m
         WHERE m.metric_key = 'whoop_recovery' AND m.measured_on = w.workout_date) AS recovery_that_day,
       (SELECT ROUND(AVG(p.strain), 1) FROM workouts p
         WHERE p.id <> w.id AND p.strain IS NOT NULL
           AND COALESCE(p.session_type, p.sport) = COALESCE(w.session_type, w.sport)
           AND p.workout_date <  w.workout_date
           AND p.workout_date >= date(w.workout_date, '-60 days')) AS typical_strain,
       (SELECT COUNT(*) FROM workouts p
         WHERE p.id <> w.id AND p.strain IS NOT NULL
           AND COALESCE(p.session_type, p.sport) = COALESCE(w.session_type, w.sport)
           AND p.workout_date <  w.workout_date
           AND p.workout_date >= date(w.workout_date, '-60 days')) AS comparable_sessions,
       ROUND(100.0 * (COALESCE(w.z1_min,0) + COALESCE(w.z2_min,0)) / NULLIF(w.duration_min, 0)) AS pct_z1_z2,
       ROUND(100.0 * COALESCE(w.z3_min,0) / NULLIF(w.duration_min, 0)) AS pct_z3,
       ROUND(100.0 * (COALESCE(w.z4_min,0) + COALESCE(w.z5_min,0)) / NULLIF(w.duration_min, 0)) AS pct_z4_z5,
       ps.title AS planned_title, ps.intent AS planned_intent, ps.key_session,
       (SELECT COUNT(*) FROM workout_sets s WHERE s.workout_id = w.id) AS sets_logged,
       w.rpe, w.notes, w.verdict
FROM workouts w
LEFT JOIN planned_sessions ps ON ps.id = w.planned_session_id
WHERE w.workout_date >= date('now','localtime','-14 days')
ORDER BY w.start_at DESC;

-- Best recent working sets per exercise, to spot progress or stalls (heaviest load in each week).
CREATE VIEW IF NOT EXISTS v_lift_trends AS
SELECT exercise, strftime('%Y-W%W', log_date) AS week,
       MAX(load_lb) AS top_load_lb,
       MAX(reps) AS max_reps,
       ROUND(AVG(rpe), 1) AS avg_rpe,
       SUM(COALESCE(sets,1)) AS total_sets
FROM workout_sets
WHERE load_lb IS NOT NULL AND log_date >= date('now','localtime','-84 days')
GROUP BY exercise, week
ORDER BY exercise, week;
