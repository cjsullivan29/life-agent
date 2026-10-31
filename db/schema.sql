-- Life CRM schema. SQLite. The agent is the only one who writes to this.
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- The areas of life. Each carries its own proactive check-in rule.
CREATE TABLE IF NOT EXISTS domains (
  id               INTEGER PRIMARY KEY,
  name             TEXT UNIQUE NOT NULL,
  purpose          TEXT,          -- why this domain matters to Christian (his words, filled in over time)
  good_looks_like  TEXT,          -- what "on track" means here
  check_in_rule    TEXT,          -- how and when the agent should be proactive about this domain
  sort_order       INTEGER
);

-- People in his life: family, friends, colleagues, contacts.
CREATE TABLE IF NOT EXISTS people (
  id                    INTEGER PRIMARY KEY,
  name                  TEXT NOT NULL,
  relationship          TEXT,     -- wife, friend, recruiter, case manager...
  domain_id             INTEGER REFERENCES domains(id),
  circle                TEXT CHECK (circle IN ('inner','close','professional','acquaintance')),
  contact_cadence_days  INTEGER,  -- how often he wants to be in touch; NULL = no nudges
  birthday              TEXT,     -- YYYY-MM-DD or MM-DD
  last_contact          TEXT,     -- date, updated when an interaction is logged
  notes                 TEXT,
  created_at            TEXT DEFAULT (datetime('now','localtime'))
);

-- Threads = the "deals" of life: projects, decisions, commitments, things to watch.
CREATE TABLE IF NOT EXISTS threads (
  id                INTEGER PRIMARY KEY,
  title             TEXT NOT NULL,
  domain_id         INTEGER REFERENCES domains(id),
  type              TEXT CHECK (type IN ('project','decision','commitment','pursuit','watch')),
  stage             TEXT,         -- free text, e.g. idea / building / shipped, or open / leaning / decided
  stage_changed_at  TEXT DEFAULT (datetime('now','localtime')),
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','parked','closed')),
  next_action       TEXT,
  waiting_on        TEXT,
  due_date          TEXT,
  notes             TEXT,
  created_at        TEXT DEFAULT (datetime('now','localtime')),
  updated_at        TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS thread_people (
  thread_id  INTEGER REFERENCES threads(id),
  person_id  INTEGER REFERENCES people(id),
  role       TEXT,
  PRIMARY KEY (thread_id, person_id)
);

-- Automatic stage history, so "how long has this been stuck?" is answerable.
CREATE TABLE IF NOT EXISTS thread_stage_history (
  id          INTEGER PRIMARY KEY,
  thread_id   INTEGER REFERENCES threads(id),
  from_stage  TEXT,
  to_stage    TEXT,
  changed_at  TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TRIGGER IF NOT EXISTS trg_thread_stage
AFTER UPDATE OF stage ON threads
WHEN COALESCE(OLD.stage,'') <> COALESCE(NEW.stage,'')
BEGIN
  INSERT INTO thread_stage_history (thread_id, from_stage, to_stage) VALUES (NEW.id, OLD.stage, NEW.stage);
  UPDATE threads SET stage_changed_at = datetime('now','localtime') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_thread_touch
AFTER UPDATE ON threads
BEGIN
  UPDATE threads SET updated_at = datetime('now','localtime') WHERE id = NEW.id AND updated_at = OLD.updated_at;
END;

-- Goals: the scoreboard. Linked to a metric when there is one.
CREATE TABLE IF NOT EXISTS goals (
  id            INTEGER PRIMARY KEY,
  domain_id     INTEGER REFERENCES domains(id),
  title         TEXT NOT NULL,
  why           TEXT,
  metric_key    TEXT REFERENCES metric_defs(key),
  target_value  REAL,
  direction     TEXT CHECK (direction IN ('up','down','hold')),
  target_date   TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','achieved','dropped'))
);

-- Entries: everything that happens. The activity timeline.
CREATE TABLE IF NOT EXISTS entries (
  id           INTEGER PRIMARY KEY,
  occurred_at  TEXT DEFAULT (datetime('now','localtime')),
  domain_id    INTEGER REFERENCES domains(id),
  type         TEXT CHECK (type IN ('note','interaction','capture','reflection','win','meal','workout','decision','checkin')),
  summary      TEXT NOT NULL,
  detail       TEXT,
  person_id    INTEGER REFERENCES people(id),
  thread_id    INTEGER REFERENCES threads(id),
  source       TEXT DEFAULT 'telegram' CHECK (source IN ('telegram','photo','routine','import','api'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY,
  title       TEXT NOT NULL,
  domain_id   INTEGER REFERENCES domains(id),
  thread_id   INTEGER REFERENCES threads(id),
  person_id   INTEGER REFERENCES people(id),
  due_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  done_at     TEXT
);

-- Numbers over time: WHOOP, diet, body comp, anything measurable.
CREATE TABLE IF NOT EXISTS metric_defs (
  key          TEXT PRIMARY KEY,
  label        TEXT NOT NULL,
  unit         TEXT,
  domain_id    INTEGER REFERENCES domains(id),
  description  TEXT
);

CREATE TABLE IF NOT EXISTS metrics (
  id           INTEGER PRIMARY KEY,
  measured_on  TEXT NOT NULL,     -- YYYY-MM-DD
  metric_key   TEXT NOT NULL REFERENCES metric_defs(key),
  value        REAL NOT NULL,
  source       TEXT,              -- whoop_screenshot, meal_estimate, manual, whoop_api
  note         TEXT,
  logged_at    TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_metrics_key_date ON metrics(metric_key, measured_on);

-- ---------- Views the agent uses for proactive checks ----------

CREATE VIEW IF NOT EXISTS v_stalled_threads AS
SELECT t.id, t.title, d.name AS domain, t.stage,
       CAST(julianday('now','localtime') - julianday(t.stage_changed_at) AS INTEGER) AS days_in_stage,
       t.next_action, t.waiting_on
FROM threads t JOIN domains d ON d.id = t.domain_id
WHERE t.status = 'active' AND julianday('now','localtime') - julianday(t.stage_changed_at) > 14
ORDER BY days_in_stage DESC;

CREATE VIEW IF NOT EXISTS v_due_tasks AS
SELECT k.id, k.title, d.name AS domain, k.due_date,
       CASE WHEN k.due_date < date('now','localtime') THEN 'overdue' ELSE 'due soon' END AS state
FROM tasks k LEFT JOIN domains d ON d.id = k.domain_id
WHERE k.status = 'open' AND k.due_date IS NOT NULL AND k.due_date <= date('now','localtime','+3 days')
ORDER BY k.due_date;

CREATE VIEW IF NOT EXISTS v_people_due AS
SELECT p.id, p.name, p.relationship, p.last_contact, p.contact_cadence_days,
       CAST(julianday('now','localtime') - julianday(COALESCE(p.last_contact, p.created_at)) AS INTEGER) AS days_since
FROM people p
WHERE p.contact_cadence_days IS NOT NULL
  AND julianday('now','localtime') - julianday(COALESCE(p.last_contact, p.created_at)) > p.contact_cadence_days
ORDER BY days_since - p.contact_cadence_days DESC;

CREATE VIEW IF NOT EXISTS v_upcoming_birthdays AS
SELECT name, relationship, birthday
FROM people
WHERE birthday IS NOT NULL
  AND (CAST(julianday(strftime('%Y','now','localtime') || '-' || substr(birthday, -5)) - julianday(date('now','localtime')) AS INTEGER) BETWEEN 0 AND 7);

CREATE VIEW IF NOT EXISTS v_quiet_domains AS
SELECT d.name, MAX(e.occurred_at) AS last_entry,
       COALESCE(CAST(julianday('now','localtime') - julianday(MAX(e.occurred_at)) AS INTEGER), 9999) AS days_quiet  -- 9999 = nothing logged yet
FROM domains d LEFT JOIN entries e ON e.domain_id = d.id
GROUP BY d.id
ORDER BY days_quiet DESC;

CREATE VIEW IF NOT EXISTS v_metrics_7d AS
SELECT m.metric_key, md.label, md.unit,
       ROUND(AVG(CASE WHEN m.measured_on >  date('now','localtime','-7 days')  THEN m.value END), 1) AS avg_last_7d,
       ROUND(AVG(CASE WHEN m.measured_on <= date('now','localtime','-7 days')
                       AND m.measured_on >  date('now','localtime','-14 days') THEN m.value END), 1) AS avg_prior_7d,
       COUNT(CASE WHEN m.measured_on > date('now','localtime','-7 days') THEN 1 END) AS readings_7d
FROM metrics m JOIN metric_defs md ON md.key = m.metric_key
WHERE m.measured_on > date('now','localtime','-14 days')
GROUP BY m.metric_key;

CREATE VIEW IF NOT EXISTS v_today_nutrition AS
SELECT metric_key, ROUND(SUM(value)) AS total
FROM metrics
WHERE measured_on = date('now','localtime') AND metric_key IN ('calories_in','protein_g','carbs_g','fat_g')
GROUP BY metric_key;
