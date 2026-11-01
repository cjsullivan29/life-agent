// Life Agent dashboard: a small Bun server over the life CRM database.
// Listens on 127.0.0.1 only. Reach it privately through `tailscale serve` (see SETUP.md).
//
//   bun run dashboard/server.ts
//
// Env:
//   AGENT_DIR                 default ~/life-agent
//   DASHBOARD_PORT            default 8787
//   DASHBOARD_ALLOWED_LOGINS  comma-separated Tailscale logins allowed in (recommended once Tailscale is set up)

import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

const AGENT_DIR = process.env.AGENT_DIR || join(process.env.HOME || "/home/agent", "life-agent");
const DB_PATH = join(AGENT_DIR, "db", "life.db");
const STATIC_DIR = join(AGENT_DIR, "dashboard", "public");
const PORT = Number(process.env.DASHBOARD_PORT || 8787);
const ALLOWED = (process.env.DASHBOARD_ALLOWED_LOGINS || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

const db = new Database(DB_PATH);
db.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");

// ------------------------------------------------------------------ helpers

const all = (sql: string, ...p: any[]) => db.query(sql).all(...p) as any[];
const one = (sql: string, ...p: any[]) => (db.query(sql).get(...p) as any) ?? null;
const run = (sql: string, ...p: any[]) => db.query(sql).run(...p);

function localToday(): string {
  // The server runs in the user's timezone (set during setup), so local date = his date.
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

const bad = (msg: string, status = 400) => json({ error: msg }, status);

function lastSyncLine(): string | null {
  const p = join(AGENT_DIR, "log", "whoop-sync.log");
  if (!existsSync(p)) return null;
  const lines = readFileSync(p, "utf8").trim().split("\n").filter(Boolean);
  return lines.length ? lines[lines.length - 1] : null;
}

function sharedDomainIds(): Set<number> {
  return new Set(all("SELECT id FROM domains WHERE shared_view = 1").map((r) => r.id));
}

function domainVisible(name: string, together: boolean): boolean {
  if (!together) return true;
  const r = one("SELECT shared_view FROM domains WHERE name = ?", name);
  return !!r?.shared_view;
}

function band(recovery: number | null) {
  if (recovery == null) return null;
  if (recovery >= 67) return { level: "high", advice: "Good day to push." };
  if (recovery >= 34) return { level: "moderate", advice: "Train as planned; don't chase PRs." };
  return { level: "low", advice: "Dial it back: easy session or mobility." };
}

// ------------------------------------------------------------------ reads

function today(together: boolean) {
  const t = localToday();
  const health = domainVisible("Health & Wellness", together);

  let body: any = null;
  if (health) {
    const latest = (key: string) =>
      one("SELECT measured_on AS date, value FROM v_daily_metrics WHERE metric_key = ? ORDER BY measured_on DESC LIMIT 1", key);
    const avg7 = (key: string) =>
      one(`SELECT ROUND(AVG(value),1) AS v FROM v_daily_metrics
           WHERE metric_key = ? AND measured_on > date(?, '-7 days') AND measured_on < ?`, key, t, t)?.v ?? null;
    const recovery = latest("whoop_recovery");
    body = {
      recovery,
      band: band(recovery?.value ?? null),
      hrv: latest("whoop_hrv"),
      hrv_avg7: avg7("whoop_hrv"),
      rhr: latest("resting_hr"),
      sleep: latest("whoop_sleep_hours"),
      sleep_perf: latest("whoop_sleep_perf"),
      strain_yesterday: one("SELECT value FROM v_daily_metrics WHERE metric_key='whoop_strain' AND measured_on = date(?, '-1 day')", t)?.value ?? null,
      protein_today: one("SELECT total FROM v_today_nutrition WHERE metric_key='protein_g'")?.total ?? 0,
      calories_today: one("SELECT total FROM v_today_nutrition WHERE metric_key='calories_in'")?.total ?? 0,
      protein_target: one("SELECT target_value AS v FROM goals WHERE metric_key='protein_g' AND status='active' AND target_value IS NOT NULL")?.v ?? null,
      calories_target: one("SELECT target_value AS v FROM goals WHERE metric_key='calories_in' AND status='active' AND target_value IS NOT NULL")?.v ?? null,
      experiment: one("SELECT * FROM v_experiments_active LIMIT 1"),
    };
  }

  const shared = sharedDomainIds();
  const taskFilter = (r: any) => !together || r.shared === 1 || shared.has(r.domain_id);

  const tasks = all(
    `SELECT k.id, k.title, k.due_date, k.shared, k.domain_id, d.name AS domain,
            CASE WHEN k.due_date < ? THEN 'overdue' WHEN k.due_date = ? THEN 'today' ELSE 'soon' END AS state
     FROM tasks k LEFT JOIN domains d ON d.id = k.domain_id
     WHERE k.status = 'open' AND k.due_date IS NOT NULL AND k.due_date <= date(?, '+3 days')
     ORDER BY k.due_date`, t, t, t).filter(taskFilter);

  const meals = all(
    `SELECT id, meal, description, shared, calories, protein_g, status FROM meal_plan
     WHERE plan_date = ? ORDER BY CASE meal WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END`, t)
    .filter((m) => !together || m.shared === 1);

  const stalled = all(
    `SELECT s.*, t.domain_id FROM v_stalled_threads s JOIN threads t ON t.id = s.id LIMIT 6`)
    .filter((r) => !together || shared.has(r.domain_id)).slice(0, 3);

  const peopleDue = together ? [] : all("SELECT * FROM v_people_due LIMIT 3");

  return {
    date: t,
    together,
    focus: together ? null : one("SELECT * FROM daily_focus WHERE focus_date = ?", t),
    body,
    sync: health ? lastSyncLine() : null,
    tasks,
    meals,
    stalled,
    people_due: peopleDue,
    birthdays: all("SELECT * FROM v_upcoming_birthdays"),
  };
}

const HEALTH_KEYS = ["whoop_recovery", "whoop_hrv", "resting_hr", "whoop_sleep_hours", "whoop_sleep_perf",
  "whoop_strain", "body_weight", "protein_g", "calories_in", "calories_burned"];

function health(days: number, together: boolean) {
  if (!domainVisible("Health & Wellness", together)) return { hidden: true };
  const t = localToday();
  const rows = all(
    `SELECT measured_on AS date, metric_key AS key, ROUND(value, 1) AS value FROM v_daily_metrics
     WHERE measured_on > date(?, ?) AND metric_key IN (${HEALTH_KEYS.map(() => "?").join(",")})
     ORDER BY measured_on`, t, `-${days} days`, ...HEALTH_KEYS);
  const series: Record<string, { date: string; value: number }[]> = {};
  for (const r of rows) (series[r.key] ||= []).push({ date: r.date, value: r.value });
  return {
    today: t,
    days,
    series,
    defs: all("SELECT key, label, unit FROM metric_defs"),
    goals: all("SELECT g.title, g.metric_key, g.target_value, g.direction, g.target_date FROM goals g WHERE status='active'"),
    trend7: all("SELECT * FROM v_metrics_7d"),
    experiments: all(
      `SELECT e.id, e.title, e.hypothesis, e.intervention, e.metric_key, e.better_direction, e.status,
              e.start_date, e.end_date, e.duration_days, e.verdict, e.baseline_value, e.result_value, e.adherence_pct,
              a.day_number, a.baseline_avg, a.baseline_days, a.current_avg, a.current_days, a.adherence_pct AS live_adherence, a.checkins
       FROM experiments e LEFT JOIN v_experiments_active a ON a.id = e.id
       ORDER BY CASE e.status WHEN 'running' THEN 0 WHEN 'evaluating' THEN 1 WHEN 'proposed' THEN 2 ELSE 3 END, e.id`),
    sync: lastSyncLine(),
  };
}

function life(together: boolean) {
  const domains = all(
    `SELECT d.id, d.name, d.purpose, d.good_looks_like, d.shared_view,
            (SELECT COUNT(*) FROM threads t WHERE t.domain_id = d.id AND t.status = 'active') AS active_threads,
            (SELECT COUNT(*) FROM tasks k WHERE k.domain_id = d.id AND k.status = 'open') AS open_tasks,
            q.days_quiet
     FROM domains d LEFT JOIN v_quiet_domains q ON q.name = d.name
     ORDER BY d.sort_order`).filter((d) => !together || d.shared_view === 1);
  const ids = new Set(domains.map((d) => d.id));
  const threads = all(
    `SELECT t.id, t.title, t.type, t.stage, t.status, t.next_action, t.waiting_on, t.due_date, t.notes, t.domain_id,
            d.name AS domain,
            CAST(julianday('now','localtime') - julianday(t.stage_changed_at) AS INTEGER) AS days_in_stage
     FROM threads t JOIN domains d ON d.id = t.domain_id
     WHERE t.status IN ('active','parked')
     ORDER BY t.status, d.sort_order, days_in_stage DESC`).filter((r) => ids.has(r.domain_id));
  const shared = sharedDomainIds();
  const tasks = all(
    `SELECT k.id, k.title, k.due_date, k.shared, k.domain_id, d.name AS domain, th.title AS thread
     FROM tasks k LEFT JOIN domains d ON d.id = k.domain_id LEFT JOIN threads th ON th.id = k.thread_id
     WHERE k.status = 'open' ORDER BY k.due_date IS NULL, k.due_date`)
    .filter((r) => !together || r.shared === 1 || shared.has(r.domain_id));
  const people = together ? [] : all(
    `SELECT p.id, p.name, p.relationship, p.circle, p.contact_cadence_days, p.last_contact, p.birthday,
            CAST(julianday('now','localtime') - julianday(COALESCE(p.last_contact, p.created_at)) AS INTEGER) AS days_since
     FROM people p ORDER BY CASE p.circle WHEN 'inner' THEN 0 WHEN 'close' THEN 1 WHEN 'professional' THEN 2 ELSE 3 END, p.name`);
  return { together, domains, threads, tasks, people };
}

function food() {
  const t = localToday();
  const weekStart = one("SELECT date(?, 'weekday 0', '-7 days') AS d", t).d as string;
  // If today is Sunday, 'weekday 0' is today; the line above then points a week back. Correct for that.
  const ws = one("SELECT CASE WHEN strftime('%w', ?) = '0' THEN ? ELSE ? END AS d", t, t, weekStart).d as string;
  return {
    today: t,
    week_start: ws,
    meals: all(
      `SELECT id, plan_date, meal, description, shared, calories, protein_g, carbs_g, fat_g, status FROM meal_plan
       WHERE plan_date >= ? AND plan_date < date(?, '+14 days')
       ORDER BY plan_date, CASE meal WHEN 'breakfast' THEN 1 WHEN 'lunch' THEN 2 WHEN 'snack' THEN 3 ELSE 4 END`, ws, ws),
    totals: all("SELECT * FROM v_meal_plan_daily_totals WHERE plan_date >= ? AND plan_date < date(?, '+14 days')", ws, ws),
    groceries: all(
      `SELECT id, item, quantity, category, checked FROM grocery_items
       WHERE checked = 0 OR week_start >= date(?, '-7 days')
       ORDER BY checked, category, item`, ws),
    protein_target: one("SELECT target_value AS v FROM goals WHERE metric_key='protein_g' AND status='active' AND target_value IS NOT NULL")?.v ?? null,
    calories_target: one("SELECT target_value AS v FROM goals WHERE metric_key='calories_in' AND status='active' AND target_value IS NOT NULL")?.v ?? null,
  };
}

function loops() {
  const t = localToday();
  return {
    focus: all("SELECT * FROM daily_focus WHERE focus_date > date(?, '-28 days') ORDER BY focus_date DESC", t),
    focus_rate: one("SELECT * FROM v_focus_hit_rate"),
    decisions: all(
      `SELECT id, title, choice, expected_outcome, confidence, decided_on, review_on, status,
              actual_outcome, outcome_vs_expected, lessons
       FROM decisions ORDER BY status, COALESCE(review_on, '9999'), decided_on DESC`),
    calibration: all("SELECT * FROM v_decision_calibration"),
    engagement: all("SELECT * FROM v_routine_engagement"),
    changes: all("SELECT * FROM agent_changes ORDER BY proposed_at DESC LIMIT 20"),
    feedback: all("SELECT * FROM agent_feedback ORDER BY occurred_at DESC LIMIT 10"),
  };
}

// ------------------------------------------------------------------ writes (whitelisted)

async function body(req: Request) {
  try { return await req.json(); } catch { return null; }
}

async function write(path: string, req: Request): Promise<Response> {
  const b = await body(req);
  if (!b || typeof b !== "object") return bad("Expected a JSON body.");
  let m: RegExpMatchArray | null;

  if ((m = path.match(/^\/api\/tasks\/(\d+)$/))) {
    if (!["open", "done", "dropped"].includes(b.status)) return bad("status must be open, done, or dropped");
    run(`UPDATE tasks SET status = ?, done_at = CASE WHEN ? = 'done' THEN datetime('now','localtime') ELSE NULL END WHERE id = ?`,
      b.status, b.status, Number(m[1]));
    return json({ ok: true });
  }
  if (path === "/api/tasks") {
    const title = String(b.title || "").trim();
    if (!title) return bad("title required");
    const r = run(`INSERT INTO tasks (title, domain_id, due_date, shared) VALUES (?, ?, ?, ?)`,
      title.slice(0, 300), b.domain_id ? Number(b.domain_id) : null,
      /^\d{4}-\d{2}-\d{2}$/.test(b.due_date || "") ? b.due_date : null, b.shared ? 1 : 0);
    return json({ ok: true, id: Number(r.lastInsertRowid) });
  }
  if ((m = path.match(/^\/api\/grocery\/(\d+)$/))) {
    run("UPDATE grocery_items SET checked = ? WHERE id = ?", b.checked ? 1 : 0, Number(m[1]));
    return json({ ok: true });
  }
  if (path === "/api/grocery") {
    const item = String(b.item || "").trim();
    if (!item) return bad("item required");
    const ws = food().week_start;
    const cat = ["produce", "protein", "dairy", "pantry", "frozen", "other"].includes(b.category) ? b.category : "other";
    const r = run("INSERT INTO grocery_items (week_start, item, quantity, category) VALUES (?, ?, ?, ?)",
      ws, item.slice(0, 120), b.quantity ? String(b.quantity).slice(0, 40) : null, cat);
    return json({ ok: true, id: Number(r.lastInsertRowid) });
  }
  if (path === "/api/focus/today") {
    const done = b.done === null ? null : b.done ? 1 : 0;
    const r = run("UPDATE daily_focus SET done = ? WHERE focus_date = ?", done, localToday());
    if (!r.changes) return bad("No focus set for today yet.", 404);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/threads\/(\d+)$/))) {
    const id = Number(m[1]);
    if (b.status !== undefined && !["active", "parked", "closed"].includes(b.status)) return bad("bad status");
    const fields: string[] = [], vals: any[] = [];
    for (const k of ["stage", "status", "next_action", "waiting_on"]) {
      if (b[k] !== undefined) { fields.push(`${k} = ?`); vals.push(b[k] === "" ? null : String(b[k]).slice(0, 300)); }
    }
    if (!fields.length) return bad("nothing to update");
    run(`UPDATE threads SET ${fields.join(", ")} WHERE id = ?`, ...vals, id);
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/meals\/(\d+)$/))) {
    if (!["planned", "eaten", "swapped", "skipped"].includes(b.status)) return bad("bad status");
    run("UPDATE meal_plan SET status = ? WHERE id = ?", b.status, Number(m[1]));
    return json({ ok: true });
  }
  if ((m = path.match(/^\/api\/domains\/(\d+)$/))) {
    run("UPDATE domains SET shared_view = ? WHERE id = ?", b.shared_view ? 1 : 0, Number(m[1]));
    return json({ ok: true });
  }
  return bad("Not found", 404);
}

// ------------------------------------------------------------------ server

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json",
};

function serveStatic(path: string): Response {
  const rel = path === "/" ? "/index.html" : path;
  if (rel.includes("..")) return new Response("Not found", { status: 404 });
  const file = Bun.file(join(STATIC_DIR, rel));
  const ext = rel.slice(rel.lastIndexOf("."));
  return new Response(file, { headers: { "content-type": TYPES[ext] || "application/octet-stream", "cache-control": "no-cache" } });
}

Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  async fetch(req) {
    if (ALLOWED.length) {
      const login = (req.headers.get("tailscale-user-login") || "").toLowerCase();
      if (!ALLOWED.includes(login)) {
        const who = login ? `Signed in to Tailscale as: ${login}` : "No Tailscale login came through (open it via your https://...ts.net address).";
        return new Response(`Not allowed.\n\n${who}\nAllowed: ${ALLOWED.join(", ")}\n\nTo fix, put the login above in local/dashboard.env and restart life-dashboard.`,
          { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    }
    const url = new URL(req.url);
    const p = url.pathname;
    const together = url.searchParams.get("together") === "1";
    try {
      if (req.method === "POST") return await write(p, req);
      if (p === "/api/today") return json(today(together));
      if (p === "/api/health") return json(health(Math.min(365, Math.max(7, Number(url.searchParams.get("days")) || 30)), together));
      if (p === "/api/life") return json(life(together));
      if (p === "/api/food") return json(food());
      if (p === "/api/loops") return json(loops());
      if (p.startsWith("/api/")) return bad("Not found", 404);
      return serveStatic(p);
    } catch (e: any) {
      console.error(e);
      return bad(`Server error: ${e?.message || e}`, 500);
    }
  },
});

console.log(`Life dashboard on http://127.0.0.1:${PORT} (db: ${DB_PATH})${ALLOWED.length ? `, allowed: ${ALLOWED.join(", ")}` : ""}`);
