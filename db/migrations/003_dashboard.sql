-- Migration 003: dashboard support.
-- Which life domains show in the dashboard's "Together" mode (joint check-ins with Maddie).
-- This is a display filter on Christian's own dashboard, not an access control.
ALTER TABLE domains ADD COLUMN shared_view INTEGER NOT NULL DEFAULT 0;
UPDATE domains SET shared_view = 1 WHERE name IN ('Faith','Family','Money','Home & Life Admin','Fun & Recreation');

-- Tasks can be marked as shared household items independent of their domain.
ALTER TABLE tasks ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;

-- Fix: on Sundays the meal-plan week view pointed at the previous week.
DROP VIEW IF EXISTS v_meal_plan_week;
CREATE VIEW v_meal_plan_week AS
SELECT plan_date, meal, description, shared, calories, protein_g, status
FROM meal_plan
WHERE plan_date >= CASE WHEN strftime('%w','now','localtime') = '0' THEN date('now','localtime')
                        ELSE date('now','localtime','weekday 0','-7 days') END
  AND plan_date <  date(CASE WHEN strftime('%w','now','localtime') = '0' THEN date('now','localtime')
                             ELSE date('now','localtime','weekday 0','-7 days') END, '+7 days')
ORDER BY plan_date, CASE meal WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END;

INSERT OR IGNORE INTO schema_migrations (version) VALUES ('003_dashboard');
