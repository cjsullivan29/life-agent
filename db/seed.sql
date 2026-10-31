-- Starting data. Statuses are as of Oct 2026 and may be stale; the agent confirms them with Christian on day one.
PRAGMA foreign_keys = ON;

-- ---------- Domains and their proactive rules ----------
INSERT INTO domains (id, name, purpose, good_looks_like, check_in_rule, sort_order) VALUES
(1, 'Faith', NULL, NULL,
 'Day one: ask what practice he wants to keep (for example worship, prayer, reading) and record it in good_looks_like. After that, a short check-in during the Sunday review only. Never preach, never assume a tradition.', 1),
(2, 'Family', NULL, NULL,
 'Weekly: in the Sunday review, ask about one intentional thing with his wife for the week ahead. Flag family birthdays 7 days out. Log what he shares about family time.', 2),
(3, 'Health & Wellness', 'Body composition goal: lean, hybrid-athlete physique.', 'Training most mornings, recovery-guided intensity, protein and calories on target for the current phase, sleep protected.',
 'Daily: the morning brief uses last night''s recovery (if logged) to suggest training intensity. Evening check-in: if no meals logged today, ask for a quick rundown. Weekly: 7-day trend vs prior 7 days on recovery, sleep, weight, protein.', 3),
(4, 'Relationships', NULL, 'Staying in touch with the people who matter, personal and professional, on purpose rather than by accident.',
 'Flag people past their contact cadence, at most 2 per brief. Prompt follow-ups he committed to. Never nag about the same person two days in a row.', 4),
(5, 'Career & Work', NULL, 'Clear priorities at Abby Care, steady progress on the job search, work with deadlines and tangible outputs.',
 'Daily: the one thing that matters most. Flag threads stuck in a stage over 14 days. Keep all Abby Care client and lead data out of this system.', 5),
(6, 'Money', NULL, NULL,
 'Weekly: surface open money decisions. Monthly (first Sunday): prompt a quick check on budget and savings goals. Facts and tradeoffs only, never investment advice.', 6),
(7, 'Growth & Learning', 'Data/statistics/programming toward ML/AI, and writing as a thinking tool.', 'Consistent weekly time on the data track; regular writing.',
 'If no learning entry in 5 days, mention it once in the morning brief. Weekly: progress on the DataCamp track and writing.', 7),
(8, 'Home & Life Admin', NULL, NULL,
 'Surface tasks due within 3 days. Bundle small admin tasks into one suggested block rather than listing them one by one.', 8),
(9, 'Fun & Recreation', NULL, 'Golf, cooking, and time that is not optimizing anything.',
 'If nothing logged here in 14 days, say so once in the Sunday review. This domain exists so the system does not turn life into a to-do list.', 9);

-- ---------- Metrics ----------
INSERT INTO metric_defs (key, label, unit, domain_id, description) VALUES
('whoop_recovery',     'Recovery',            '%',     3, 'WHOOP recovery score'),
('whoop_strain',       'Strain',              '',      3, 'WHOOP day strain (0-21)'),
('whoop_sleep_hours',  'Sleep',               'hours', 3, 'Hours of sleep'),
('whoop_sleep_perf',   'Sleep performance',   '%',     3, 'WHOOP sleep performance'),
('whoop_hrv',          'HRV',                 'ms',    3, 'Heart rate variability'),
('resting_hr',         'Resting heart rate',  'bpm',   3, 'Resting heart rate'),
('calories_burned',    'Calories burned',     'kcal',  3, 'Total calories burned (WHOOP)'),
('calories_in',        'Calories eaten',      'kcal',  3, 'Per meal; daily total = sum. Estimates from photos/descriptions are labeled as estimates.'),
('protein_g',          'Protein',             'g',     3, 'Per meal; daily total = sum'),
('carbs_g',            'Carbs',               'g',     3, 'Per meal; daily total = sum'),
('fat_g',              'Fat',                 'g',     3, 'Per meal; daily total = sum'),
('body_weight',        'Body weight',         'lb',    3, 'Scale weight. Only meaningful as a trend.'),
('body_fat_pct',       'Body fat',            '%',     3, 'Body fat percentage, if measured'),
('workout_minutes',    'Workout minutes',     'min',   3, 'Training time'),
('learning_minutes',   'Learning time',       'min',   7, 'DataCamp, coding, study');

-- ---------- Goals (targets set with Christian on day one) ----------
INSERT INTO goals (domain_id, title, why, metric_key, target_value, direction, target_date) VALUES
(3, 'Lean out during the cut phase', 'Body composition goal; hybrid-athlete physique', 'body_weight', NULL, 'down', NULL),
(3, 'Hit daily protein target', 'Preserve muscle during the cut', 'protein_g', NULL, 'hold', NULL),
(7, 'Steady weekly time on the data track', 'Data skills toward ML/AI', 'learning_minutes', NULL, 'up', NULL);

-- ---------- People ----------
INSERT INTO people (id, name, relationship, domain_id, circle, contact_cadence_days, notes) VALUES
(1, 'Wife', 'wife', 2, 'inner', NULL, 'Ask Christian for her name on day one and update this record.');

-- ---------- Threads (from what Christian has shared through Oct 2026) ----------
INSERT INTO threads (title, domain_id, type, stage, status, next_action, waiting_on, notes) VALUES
('Medicare certification survey: source 10 pro bono patients', 5, 'project', 'sourcing', 'active', 'Confirm current count and pipeline', NULL, 'Started from zero; not services Abby traditionally provides.'),
('Case Management Coordinator: MCO case manager proof of concept', 5, 'project', 'planning', 'active', 'Confirm whether outreach has started', 'GM sign-off on outreach (as of Sept)', 'Thesis: case managers both authorize hours and send referrals. 2-4 week POC with 2-3 receptive case managers.'),
('Family experience journey rebuild (Indiana pilot)', 5, 'project', 'design', 'active', 'Front end (non-paid awareness) and care delivery side', NULL, 'Must absorb a ~500-case MCO bulk handoff.'),
('Curant pitch at Abby product hackathon', 5, 'project', 'prep', 'active', 'Confirm hackathon date', NULL, 'Curant built natively into Abby''s platform; churn from billing, scheduling, miscommunication.'),
('MCO PA denials for family caregivers', 5, 'watch', 'watching', 'active', NULL, NULL, 'Down to 1 MCO for PA-based work. Strategic risk to tenure.'),
('Job search: data/analytics or technical implementation roles', 5, 'pursuit', 'searching', 'active', 'Confirm status of RevPartners application', NULL, 'Prefers healthcare-adjacent, early-stage, full tool authority. Also considering nursing school.'),
('DataCamp Data Analyst in Python track', 7, 'pursuit', 'in progress', 'active', 'Confirm current module and weekly time target', NULL, 'Long-term aim: ML/AI.'),
('Writing and LinkedIn presence', 7, 'pursuit', 'drafting', 'active', 'Has the first post gone out?', NULL, 'Writing as a thinking tool first. Observational voice on home care.'),
('Indiana Home Care Rules (free regs Q&A tool)', 7, 'project', 'testing', 'active', NULL, 'Tester feedback', 'Answers only from official documents, with citations.'),
('21-week training program (cut, then HYROX block)', 3, 'commitment', 'cut phase', 'active', NULL, NULL, 'Jul-Dec 2026. Trains 5-6am most mornings. Hip mobility work for golf and lifting.'),
('Life insurance policy: keep or unwind', 6, 'decision', 'leaning', 'active', 'Decide and act', NULL, 'Leaning toward canceling and redirecting to 401(k), IRA, then HSA, with term coverage instead.'),
('Life agent v1', 8, 'project', 'building', 'active', 'Finish setup; run 2 weeks; then WHOOP API and calendar', NULL, NULL),
('Fitness app on WHOOP data', 3, 'project', 'idea', 'parked', NULL, NULL, 'Parked: the life agent''s health domain now covers this. Revisit only if the agent falls short.'),
('Colorado move (Fraser, CO)', 8, 'decision', 'exploring', 'parked', NULL, NULL, 'No timeline. Remote vs new job; buy vs rent.'),
('Sulli''s Vending', 6, 'project', 'shelved', 'closed', NULL, NULL, 'Shelved Aug 2026.'),
('Curam Advisory / Curant as a standalone venture', 5, 'project', 'closed', 'closed', NULL, NULL, 'Closed Sept 2026: too many threads in ideation; cold prospecting a poor fit.');

-- ---------- Decisions he has made, so the agent can hold him to them ----------
INSERT INTO entries (occurred_at, domain_id, type, summary, source) VALUES
('2026-09-18 12:00:00', 7, 'decision', 'Skill-building time goes to data/programming and writing, not new side ventures.', 'import'),
('2026-09-18 12:00:00', 5, 'decision', 'Closed Curam Advisory / Curant as a venture: too many threads stuck in ideation; cold prospecting a poor fit.', 'import'),
(datetime('now','localtime'), 8, 'decision', 'Life agent runs on Telegram + a cloud server; it is a life CRM where the agent does all the logging.', 'import');
