-- Migration 007: WHOOP data fixes.
--
-- 1. Day strain and calories burned were stored one day early. A WHOOP cycle starts when you fall
--    asleep, usually the evening before, and the sync used that start date. whoop.py now dates each
--    cycle by the morning you woke up (the same day as its recovery). The old rows are removed here;
--    re-pull them once with:  python3 ~/life-agent/scripts/whoop.py sync --days 180
--    (run as the agent user). Until then, strain and calories burned are simply missing, not zero.
--    Manual or screenshot values are kept.
DELETE FROM metrics
WHERE metric_key IN ('whoop_strain', 'calories_burned') AND source = 'whoop_api';

-- 2. percent_recorded came from WHOOP as a 0-1 fraction, but the agent checks "under 80".
--    Store it as 0-100. New syncs already convert.
UPDATE workouts SET percent_recorded = ROUND(percent_recorded * 100, 1)
WHERE percent_recorded IS NOT NULL AND percent_recorded <= 1;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('007_whoop_day_fixes');
