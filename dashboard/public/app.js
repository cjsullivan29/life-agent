// Life dashboard. Vanilla JS, no build step. All data from /api/* on the same server.

const $view = document.getElementById("view");
const $tip = document.getElementById("tooltip");
const $toast = document.getElementById("toast");
const $together = document.getElementById("together");
const TABS = ["today", "health", "goals", "life", "food", "loops"];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  together: store.get("together", false),
  days: store.get("healthDays", 30),
  domain: null,
  newBlock: false,
};
$together.checked = state.together;

// ------------------------------------------------------------------ DOM helpers

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style") el.style.cssText = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const svgNS = "http://www.w3.org/2000/svg";
function s(tag, attrs, ...kids) {
  const el = document.createElementNS(svgNS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const kid of kids.flat()) if (kid != null) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const card = (title, aside, ...body) =>
  h("section", { class: "card" }, h("h2", {}, h("span", {}, title), aside ? h("span", { class: "aside" }, aside) : null), ...body);
const empty = (text) => h("p", { class: "empty" }, text);

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2200);
}

// ------------------------------------------------------------------ formatting

const fmtDate = (iso, opts = { weekday: "short", month: "short", day: "numeric" }) =>
  iso ? new Date(iso + "T12:00:00").toLocaleDateString(undefined, opts) : "";
const fmtShort = (iso) => fmtDate(iso, { month: "short", day: "numeric" });
const fmtNum = (v, d = 0) => (v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

const BANDS = {
  high: { label: "Green", color: "var(--good)" },
  moderate: { label: "Yellow", color: "var(--warning)" },
  low: { label: "Red", color: "var(--critical)" },
};
const bandOf = (v) => (v == null ? null : v >= 67 ? "high" : v >= 34 ? "moderate" : "low");

function syncNote(line) {
  if (!line) return "WHOOP not synced yet";
  const when = line.slice(0, 16);
  return line.includes("SYNC OK") ? `WHOOP synced ${when.slice(11)} ${fmtShort(when.slice(0, 10))}` : `WHOOP sync failed ${when}`;
}

// ------------------------------------------------------------------ API

async function api(path) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${path}${sep}together=${state.together ? 1 : 0}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { toast(data.error || "Couldn't save"); throw new Error(data.error); }
  return data;
}

// ------------------------------------------------------------------ charts

// One series per chart (the title names it, so no legend box). Hover/tap shows a crosshair readout.
function chart({ points, kind = "line", unit = "", decimals = 0, target = null, targetLabel = "",
                 colorFor = null, minZero = kind === "bar", height = 160 }) {
  // Draw at roughly the on-screen width so axis text stays a readable size on phones.
  const W = matchMedia("(max-width: 819px)").matches ? Math.max(300, Math.min(560, window.innerWidth - 66)) : 600;
  const H = W < 600 ? Math.round(height * 0.9) : height, L = 34, R = 10, T = 12, B = 22;
  if (!points.length) return empty("No data in this range yet.");
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals, target ?? Infinity), hi = Math.max(...vals, target ?? -Infinity);
  if (minZero) lo = 0;
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.12;
  if (!minZero) lo -= pad;
  hi += pad;
  const ticks = niceTicks(lo, hi, 4);
  lo = Math.min(lo, ticks[0]); hi = Math.max(hi, ticks[ticks.length - 1]);
  const n = points.length;
  const band = (W - L - R) / n;
  const x = (i) => kind === "bar" ? L + band * i + band / 2 : L + (n === 1 ? (W - L - R) / 2 : ((W - L - R) * i) / (n - 1));
  const y = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));

  const svg = s("svg", { class: "chart", viewBox: `0 0 ${W} ${H}`, role: "img",
    "aria-label": `${points.length} values from ${fmtShort(points[0].date)} to ${fmtShort(points[n - 1].date)}` });
  svg.append(s("g", { class: "grid" }, ticks.map((t) => s("line", { x1: L, x2: W - R, y1: y(t), y2: y(t) }))));
  ticks.forEach((t) => svg.append(s("text", { x: L - 6, y: y(t) + 4, "text-anchor": "end" }, fmtNum(t, Math.abs(hi - lo) < 5 ? 1 : 0))));
  // x labels: first, middle, last
  [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).forEach((i, k, arr) =>
    svg.append(s("text", { x: x(i), y: H - 4, "text-anchor": k === 0 && arr.length > 1 ? "start" : k === arr.length - 1 && arr.length > 1 ? "end" : "middle" }, fmtShort(points[i].date))));

  if (kind === "bar") {
    const bw = Math.min(24, Math.max(2, band - 2));
    const base = y(Math.max(lo, 0));
    points.forEach((p, i) => {
      const top = y(p.value), hgt = Math.max(1, base - top), r = Math.min(4, bw / 2, hgt);
      const x0 = x(i) - bw / 2;
      // 4px rounded data-end, square at the baseline
      const d = `M${x0},${base} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bw - r} Q${x0 + bw},${top} ${x0 + bw},${top + r} V${base} Z`;
      svg.append(s("path", { class: "bar", d, style: colorFor ? `fill:${colorFor(p.value)}` : null }));
    });
    svg.append(s("line", { class: "baseline", x1: L, x2: W - R, y1: base, y2: base }));
  } else {
    const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
    svg.append(s("path", { class: "area", d: `${d} L${x(n - 1)},${H - B} L${x(0)},${H - B} Z` }));
    svg.append(s("path", { class: "line", d }));
    svg.append(s("circle", { class: "end", cx: x(n - 1), cy: y(points[n - 1].value), r: 4.5 }));
  }
  if (target != null) {
    svg.append(s("line", { class: "target", x1: L, x2: W - R, y1: y(target), y2: y(target) }));
  }

  // hover / tap
  const cross = s("line", { class: "crosshair", y1: T, y2: H - B, visibility: "hidden" });
  const hit = s("rect", { x: L, y: 0, width: W - L - R, height: H, fill: "transparent", tabindex: 0 });
  svg.append(cross, hit);
  const show = (i, cx, cy) => {
    const p = points[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.setAttribute("visibility", "visible");
    $tip.replaceChildren(h("div", { class: "tv" }, `${fmtNum(p.value, decimals)}${unit === "%" ? "%" : unit ? " " + unit : ""}`), h("div", { class: "tl" }, fmtDate(p.date)));
    $tip.hidden = false;
    const tw = $tip.offsetWidth;
    $tip.style.left = `${Math.min(window.innerWidth - tw - 8, Math.max(8, cx - tw / 2))}px`;
    $tip.style.top = `${Math.max(8, cy - 56)}px`;
  };
  const nearest = (ev) => {
    const r = svg.getBoundingClientRect();
    const px = ((ev.clientX - r.left) / r.width) * W;
    let best = 0, bd = Infinity;
    points.forEach((_, i) => { const dd = Math.abs(x(i) - px); if (dd < bd) { bd = dd; best = i; } });
    return best;
  };
  hit.addEventListener("pointermove", (ev) => show(nearest(ev), ev.clientX, ev.clientY));
  hit.addEventListener("pointerdown", (ev) => show(nearest(ev), ev.clientX, ev.clientY));
  const hide = () => { cross.setAttribute("visibility", "hidden"); $tip.hidden = true; };
  hit.addEventListener("pointerleave", hide);
  hit.addEventListener("blur", hide);
  hit.addEventListener("focus", () => { const r = svg.getBoundingClientRect(); show(n - 1, r.right - 40, r.top + 30); });
  return svg;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => span / st <= count) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out.length >= 2 ? out : [lo, hi];
}

function dataTable(points, unit, decimals) {
  return h("div", { class: "table-wrap" }, h("table", {},
    h("thead", {}, h("tr", {}, h("th", {}, "Date"), h("th", { class: "num" }, unit || "Value"))),
    h("tbody", {}, [...points].reverse().map((p) => h("tr", {}, h("td", {}, fmtDate(p.date)), h("td", { class: "num" }, fmtNum(p.value, decimals)))))));
}

function chartCard({ title, points, unit, decimals = 0, kind, target, targetLabel, colorFor, note, betterUp = true, extra, weekly = false }) {
  const last = points.at(-1);
  const recent = points.slice(-7).map((p) => p.value), prior = points.slice(-14, -7).map((p) => p.value);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const a7 = avg(recent), p7 = avg(prior);
  let delta = null;
  if (weekly) {
    const prev = points.at(-2);
    delta = prev ? `${last.value - prev.value >= 0 ? "+" : "−"}${fmtNum(Math.abs(last.value - prev.value), decimals)} vs previous` : null;
  } else if (a7 != null && p7 != null && prior.length >= 3) {
    const d = a7 - p7;
    delta = `7-day avg ${fmtNum(a7, decimals)} (${d >= 0 ? "+" : "−"}${fmtNum(Math.abs(d), decimals)} vs prior week)`;
  } else if (a7 != null) delta = `7-day avg ${fmtNum(a7, decimals)}`;
  const tableBox = h("div", { hidden: true });
  const toggle = h("button", { class: "data-toggle", type: "button", onclick: () => {
    tableBox.hidden = !tableBox.hidden;
    if (!tableBox.hidden && !tableBox.firstChild) tableBox.append(dataTable(points, unit, decimals));
    toggle.textContent = tableBox.hidden ? "Show data" : "Hide data";
  } }, "Show data");
  return h("section", { class: "card chart-card" },
    h("h2", {}, h("span", {}, title), points.length ? toggle : null),
    last ? h("div", { class: "headline" }, h("span", { class: "v" }, `${fmtNum(last.value, decimals)}${unit && unit !== "%" ? "" : unit || ""}`),
      h("span", { class: "d" }, unit && unit !== "%" ? `${unit} · ` : "", fmtShort(last.date), delta ? ` · ${delta}` : "", targetLabel ? ` · line = ${targetLabel}` : "")) : null,
    chart({ points, kind, unit, decimals, target, targetLabel, colorFor }),
    extra || null,
    note ? h("p", { class: "muted small", style: "margin:8px 0 0" }, note) : null,
    tableBox);
}

// ------------------------------------------------------------------ views

async function renderToday() {
  const d = await api("/api/today");
  const out = [];
  out.push(h("div", { class: "view-head" }, h("h1", {}, fmtDate(d.date, { weekday: "long", month: "long", day: "numeric" })),
    h("span", { class: "sub" }, d.body ? syncNote(d.sync) : "")));
  if (d.together) out.push(h("div", { class: "banner" }, "Together mode: showing shared areas only."));

  const grid = h("div", { class: "grid cols-3" });

  if (d.focus || !d.together) {
    const f = d.focus;
    grid.append(card("The one thing", f ? null : "set in the morning brief",
      f ? [h("p", { class: "focus-text" }, f.focus),
           h("div", { class: "seg", role: "group", "aria-label": "Did it get done?" },
             [["Done", 1], ["Not yet", null], ["Didn't", 0]].map(([label, val]) =>
               h("button", { type: "button", "aria-pressed": String(f.done === val), onclick: async () => {
                 await post("/api/focus/today", { done: val }); toast("Saved"); route(); } }, label)))]
        : empty("Nothing set yet today. The agent picks it at 6:45am on weekdays.")));
  }

  if (d.body) {
    const b = d.body, rec = b.recovery?.value ?? null, bk = bandOf(rec);
    const hrvDelta = b.hrv?.value != null && b.hrv_avg7 != null ? b.hrv.value - b.hrv_avg7 : null;
    grid.append(card("Recovery", b.recovery ? fmtShort(b.recovery.date) : null,
      rec == null ? empty("No recovery yet. It appears after WHOOP scores your sleep.") : [
        h("div", { class: "hero" },
          h("div", {}, h("span", { class: "big" }, fmtNum(rec)), h("span", { class: "unit" }, "%")),
          h("div", {}, h("span", { class: "status" }, h("span", { class: "dot", style: `background:${BANDS[bk].color}` }), BANDS[bk].label),
            h("div", { class: "small muted", style: "margin-top:6px" }, b.band?.advice))),
        h("div", { class: "stats" },
          h("div", { class: "stat" }, h("div", { class: "label" }, "HRV"), h("div", { class: "value" }, fmtNum(b.hrv?.value), h("span", { class: "muted small" }, " ms")),
            h("div", { class: "delta" }, hrvDelta == null ? "" : `${hrvDelta >= 0 ? "+" : "−"}${fmtNum(Math.abs(hrvDelta))} vs 7-day`)),
          h("div", { class: "stat" }, h("div", { class: "label" }, "Sleep"), h("div", { class: "value" }, fmtNum(b.sleep?.value, 1), h("span", { class: "muted small" }, " h")),
            h("div", { class: "delta" }, b.sleep_perf ? `${fmtNum(b.sleep_perf.value)}% performance` : "")),
          h("div", { class: "stat" }, h("div", { class: "label" }, "Resting HR"), h("div", { class: "value" }, fmtNum(b.rhr?.value), h("span", { class: "muted small" }, " bpm")),
            h("div", { class: "delta" }, b.strain_yesterday != null ? `strain ${fmtNum(b.strain_yesterday, 1)} yday` : "")))]));

    const meter = (label, val, target, unit) => h("div", {},
      h("div", { class: "meter-row" }, h("span", {}, label), h("span", {}, `${fmtNum(val)} / ${target ? fmtNum(target) : "–"} ${unit}`)),
      h("div", { class: "meter", role: "meter", "aria-valuenow": val, "aria-valuemax": target || 0, "aria-label": label },
        h("span", { style: `width:${target ? Math.min(100, (val / target) * 100) : 0}%` })));
    grid.append(card("Fuel today", null,
      meter("Protein", b.protein_today, b.protein_target, "g"),
      h("div", { style: "height:10px" }),
      meter("Calories", b.calories_today, b.calories_target, "kcal"),
      d.meals.length ? h("ul", { class: "list", style: "margin-top:12px" }, d.meals.map(mealItem)) : h("p", { class: "muted small", style: "margin:12px 0 0" }, "No meals planned for today.")));

    if (b.experiment) {
      const e = b.experiment;
      grid.append(card("Experiment", `day ${Math.min(e.day_number, e.duration_days)} of ${e.duration_days}`,
        h("p", { class: "focus-text", style: "font-size:16px" }, e.title),
        h("p", { class: "small muted", style: "margin:0 0 10px" }, e.intervention),
        h("dl", { class: "kv" },
          h("dt", {}, "Baseline"), h("dd", {}, `${fmtNum(e.baseline_avg, 1)} (${e.baseline_days} days)`),
          h("dt", {}, "So far"), h("dd", {}, `${fmtNum(e.current_avg, 1)} (${e.current_days} days)`),
          h("dt", {}, "Adherence"), h("dd", {}, e.checkins ? `${fmtNum(e.adherence_pct)}% of ${plural(e.checkins, "check-in")}` : "no check-ins yet"))));
    }
  } else if (d.meals.length) {
    grid.append(card("Dinner tonight", null, h("ul", { class: "list" }, d.meals.map(mealItem))));
  }

  grid.append(card("Due soon", d.tasks.length ? plural(d.tasks.length, "task") : null,
    d.tasks.length ? h("ul", { class: "list" }, d.tasks.map(taskItem)) : empty("Nothing due in the next 3 days.")));

  if (d.people_due.length) grid.append(card("Reach out", null, h("ul", { class: "list" }, d.people_due.map((p) =>
    h("li", {}, h("div", { class: "grow" }, h("div", {}, p.name), h("div", { class: "meta" }, `${p.relationship || ""} · ${p.days_since} days since contact (aim: every ${p.contact_cadence_days})`)))))));

  if (d.stalled.length) grid.append(card("Stuck", "no movement in 14+ days", h("ul", { class: "list" }, d.stalled.map((t) =>
    h("li", {}, h("div", { class: "grow" }, h("div", {}, t.title), h("div", { class: "meta" }, `${t.domain} · ${t.stage || "no stage"} · ${t.days_in_stage} days`)))))));

  if (d.birthdays.length) grid.append(card("Birthdays this week", null, h("ul", { class: "list" }, d.birthdays.map((p) =>
    h("li", {}, h("div", { class: "grow" }, p.name, h("div", { class: "meta" }, `${p.relationship || ""} · ${p.birthday}`)))))));

  out.push(grid);
  return out;
}

function mealItem(m) {
  return h("li", {}, h("input", { type: "checkbox", class: "check", "aria-label": `Mark ${m.meal} eaten`, checked: m.status === "eaten",
      onchange: async (e) => { await post(`/api/meals/${m.id}`, { status: e.target.checked ? "eaten" : "planned" }); toast(e.target.checked ? "Marked eaten" : "Unmarked"); } }),
    h("div", { class: "grow" }, h("div", { class: m.status === "eaten" ? "done-text" : "" }, m.description),
      h("div", { class: "meta" }, m.meal, m.shared ? " · shared" : "", m.protein_g && !state.together ? ` · ~${fmtNum(m.protein_g)}g protein` : "")));
}

function taskItem(t) {
  const label = t.state === "overdue" ? h("span", { class: "pill bad" }, "overdue") : t.state === "today" ? h("span", { class: "pill warn" }, "today") : null;
  return h("li", {},
    h("input", { type: "checkbox", class: "check", "aria-label": `Done: ${t.title}`, onchange: async (e) => {
      await post(`/api/tasks/${t.id}`, { status: e.target.checked ? "done" : "open" });
      e.target.closest("li").querySelector(".grow > div").classList.toggle("done-text", e.target.checked);
      toast(e.target.checked ? "Done" : "Reopened"); } }),
    h("div", { class: "grow" }, h("div", {}, t.title),
      h("div", { class: "meta" }, [t.domain, t.thread, t.due_date ? `due ${fmtShort(t.due_date)}` : null, t.shared ? "shared" : null].filter(Boolean).join(" · "))),
    label);
}

async function renderHealth() {
  const d = await api(`/api/health?days=${state.days}`);
  if (d.hidden) return [h("div", { class: "view-head" }, h("h1", {}, "Health")),
    h("div", { class: "banner" }, "Health is private in Together mode. Turn it on under Loops → Together mode if you want it shown.")];
  const PARTIAL = new Set(["protein_g", "calories_in", "whoop_strain"]);  // today isn't finished yet
  const S = (k) => (d.series[k] || []).filter((p) => !(PARTIAL.has(k) && p.date === d.today));
  const goal = (k) => d.goals.find((g) => g.metric_key === k)?.target_value ?? null;
  const out = [h("div", { class: "view-head" }, h("h1", {}, "Health"),
    h("div", { class: "seg", role: "group", "aria-label": "Range" }, [14, 30, 90].map((n) =>
      h("button", { type: "button", "aria-pressed": String(state.days === n), onclick: () => { state.days = n; store.set("healthDays", n); route(); } }, `${n} days`))))];
  out.push(h("p", { class: "muted small", style: "margin:-6px 0 14px" }, syncNote(d.sync)));

  const bandColor = (v) => BANDS[bandOf(v)].color;
  const charts = h("div", { class: "charts" },
    chartCard({ title: "Recovery", points: S("whoop_recovery"), unit: "%", kind: "bar", colorFor: bandColor,
      note: "Green 67%+ · Yellow 34–66% · Red 33% or less" }),
    chartCard({ title: "HRV", points: S("whoop_hrv"), unit: "ms" }),
    chartCard({ title: "Sleep", points: S("whoop_sleep_hours"), unit: "h", decimals: 1 }),
    chartCard({ title: "Resting heart rate", points: S("resting_hr"), unit: "bpm" }),
    chartCard({ title: "Day strain", points: S("whoop_strain"), unit: "", decimals: 1, kind: "bar", note: "Finished days only; today's strain is still adding up." }),
    chartCard({ title: "Body weight", points: S("body_weight"), unit: "lb", decimals: 1, note: "A trend, not a verdict: single weigh-ins swing with water and food." }),
    chartCard({ title: "Protein", points: S("protein_g"), unit: "g", kind: "bar", target: goal("protein_g"), targetLabel: goal("protein_g") ? `${goal("protein_g")}g target` : "", note: "Finished days only. Today's running total is on the Today tab." }),
    chartCard({ title: "Calories eaten", points: S("calories_in"), unit: "kcal", kind: "bar", target: goal("calories_in"), targetLabel: goal("calories_in") ? `${fmtNum(goal("calories_in"))} kcal target` : "" }),
  );
  out.push(charts);

  const exps = d.experiments;
  const active = exps.filter((e) => ["running", "evaluating"].includes(e.status));
  const done = exps.filter((e) => ["kept", "dropped", "abandoned"].includes(e.status));
  const proposed = exps.filter((e) => e.status === "proposed");
  const expGrid = h("div", { class: "grid cols-2", style: "margin-top:12px" });
  expGrid.append(card("Experiments", active.length ? "one at a time" : "none running",
    active.length ? active.map((e) => h("div", {},
      h("p", { class: "focus-text", style: "font-size:16px;margin-bottom:4px" }, e.title, " ", h("span", { class: "pill" }, e.status)),
      h("p", { class: "small muted", style: "margin:0 0 10px" }, e.intervention),
      h("dl", { class: "kv" },
        h("dt", {}, "Day"), h("dd", {}, `${Math.min(e.day_number ?? 0, e.duration_days)} of ${e.duration_days}`),
        h("dt", {}, "Baseline"), h("dd", {}, `${fmtNum(e.baseline_avg, 1)} · ${plural(e.baseline_days ?? 0, "day")}`),
        h("dt", {}, "During"), h("dd", {}, `${fmtNum(e.current_avg, 1)} · ${plural(e.current_days ?? 0, "day")}`),
        h("dt", {}, "Adherence"), h("dd", {}, e.checkins ? `${fmtNum(e.live_adherence)}%` : "–")))) :
      [empty("No experiment running. Tell the agent which one to start."),
       proposed.length ? h("ul", { class: "list", style: "margin-top:10px" }, proposed.map((e) =>
         h("li", {}, h("div", { class: "grow" }, h("div", {}, e.title), h("div", { class: "meta" }, e.intervention))))) : null]));
  expGrid.append(card("Results", done.length ? plural(done.length, "experiment") : null,
    done.length ? h("ul", { class: "list" }, done.map((e) => h("li", {}, h("div", { class: "grow" },
      h("div", {}, e.title, " ", h("span", { class: "pill" }, e.status)),
      h("div", { class: "meta" }, e.verdict || `${fmtNum(e.baseline_value, 1)} → ${fmtNum(e.result_value, 1)}`)))))
      : empty("Finished experiments and their verdicts land here.")));
  out.push(expGrid);
  return out;
}

async function renderLife() {
  const d = await api("/api/life");
  const out = [h("div", { class: "view-head" }, h("h1", {}, "Life"), h("span", { class: "sub" }, state.domain ? "Tap the area again to clear" : "Tap an area to filter"))];
  if (d.together) out.push(h("div", { class: "banner" }, "Together mode: showing shared areas only."));
  if (state.domain && !d.domains.some((x) => x.id === state.domain)) state.domain = null;

  const domainGrid = h("div", { class: "domains" }, d.domains.map((dm) =>
    h("button", { type: "button", class: "domain", "aria-pressed": String(state.domain === dm.id), onclick: () => { state.domain = state.domain === dm.id ? null : dm.id; route(); } },
      h("div", { class: "name" }, dm.name),
      h("div", { class: "counts" }, `${plural(dm.active_threads, "thread")} · ${plural(dm.open_tasks, "task")}`,
        dm.days_quiet >= 9999 ? " · nothing logged" : dm.days_quiet > 14 ? ` · quiet ${dm.days_quiet}d` : ""))));

  const threads = d.threads.filter((t) => !state.domain || t.domain_id === state.domain);
  const active = threads.filter((t) => t.status === "active"), parked = threads.filter((t) => t.status === "parked");
  const threadRow = (t) => h("li", { class: t.status === "active" && t.days_in_stage > 14 ? "stalled" : "" },
    h("div", { class: "grow" },
      h("div", {}, t.title, t.status === "active" && t.days_in_stage > 14 ? h("span", { class: "pill warn", style: "margin-left:6px" }, `${t.days_in_stage}d in stage`) : null),
      h("div", { class: "meta" }, [t.domain, t.stage, t.type].filter(Boolean).join(" · ")),
      t.next_action ? h("div", { class: "small", style: "margin-top:3px" }, "Next: ", t.next_action) : null,
      t.waiting_on ? h("div", { class: "small muted" }, "Waiting on: ", t.waiting_on) : null),
    h("div", { style: "display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end" },
      h("button", { class: "btn ghost small", type: "button", onclick: async () => {
        const v = prompt(`Stage for "${t.title}"`, t.stage || ""); if (v === null) return;
        await post(`/api/threads/${t.id}`, { stage: v }); toast("Stage updated"); route(); } }, "Stage"),
      h("button", { class: "btn ghost small", type: "button", onclick: async () => {
        await post(`/api/threads/${t.id}`, { status: t.status === "active" ? "parked" : "active" }); toast(t.status === "active" ? "Parked" : "Reactivated"); route(); } },
        t.status === "active" ? "Park" : "Resume"),
      h("button", { class: "btn ghost small", type: "button", onclick: async () => {
        if (!confirm(`Close "${t.title}"?`)) return;
        await post(`/api/threads/${t.id}`, { status: "closed" }); toast("Closed"); route(); } }, "Close")));

  const tasks = d.tasks.filter((t) => !state.domain || t.domain_id === state.domain);
  const addTitle = h("input", { placeholder: "Add a task", "aria-label": "New task" });
  const addDue = h("input", { type: "date", "aria-label": "Due date", style: "flex:0 0 auto;width:auto" });
  const addForm = h("form", { class: "add", onsubmit: async (e) => {
    e.preventDefault(); if (!addTitle.value.trim()) return;
    await post("/api/tasks", { title: addTitle.value, due_date: addDue.value, domain_id: state.domain, shared: state.together });
    toast("Task added"); route(); } }, addTitle, addDue, h("button", { type: "submit" }, "Add"));

  const grid = h("div", { class: "grid cols-3", style: "margin-top:12px" });
  grid.append(h("div", { class: "span-2", style: "display:grid;gap:12px;min-width:0" },
    card("Active threads", plural(active.length, "thread"), active.length ? h("ul", { class: "list" }, active.map(threadRow)) : empty("No active threads here.")),
    parked.length ? h("section", { class: "card" }, h("details", { class: "more" }, h("summary", {}, `Parked (${parked.length})`),
      h("ul", { class: "list", style: "margin-top:8px" }, parked.map(threadRow)))) : null));
  const side = h("div", { style: "display:grid;gap:12px;align-content:start;min-width:0" });
  side.append(card("Open tasks", tasks.length ? String(tasks.length) : null,
    tasks.length ? h("ul", { class: "list" }, tasks.map(taskItem)) : empty("No open tasks."), addForm));
  if (d.people.length && !state.domain) side.append(card("People", null, h("ul", { class: "list" }, d.people.map((p) =>
    h("li", {}, h("div", { class: "grow" }, h("div", {}, p.name),
      h("div", { class: "meta" }, [p.relationship, p.circle, p.last_contact ? `last ${fmtShort(p.last_contact.slice(0, 10))}` : "no contact logged"].filter(Boolean).join(" · "))),
      p.contact_cadence_days && p.days_since > p.contact_cadence_days ? h("span", { class: "pill warn" }, "due") : null)))));
  grid.append(side);
  out.push(domainGrid, grid);
  return out;
}

async function renderFood() {
  const d = await api("/api/food");
  const out = [h("div", { class: "view-head" }, h("h1", {}, "Food"), h("span", { class: "sub" }, `Week of ${fmtShort(d.week_start)}`))];
  const byDate = {};
  for (const m of d.meals) (byDate[m.plan_date] ||= []).push(m);
  const totals = Object.fromEntries(d.totals.map((t) => [t.plan_date, t]));
  const weekGrid = (startIso) => {
    const days = [...Array(7)].map((_, i) => { const dt = new Date(startIso + "T12:00:00"); dt.setDate(dt.getDate() + i); return dt.toISOString().slice(0, 10); });
    const narrow = matchMedia("(max-width: 819px)").matches;
    const dayCard = (iso) => {
      const meals = (byDate[iso] || []).filter((m) => !state.together || m.shared);
      const tot = totals[iso];
      return h("div", { class: `day${iso === d.today ? " today" : ""}` },
        h("h3", {}, h("span", {}, fmtDate(iso, { weekday: "short", day: "numeric" })),
          !state.together && tot?.planned_protein ? h("span", { class: "muted", style: "font-weight:400" }, `${fmtNum(tot.planned_protein)}g`) : null),
        meals.length ? meals.map((m) => h("div", { class: `meal${m.status === "eaten" ? " eaten" : ""}`, role: "button", tabindex: 0,
          title: "Tap to mark eaten",
          onclick: async () => { await post(`/api/meals/${m.id}`, { status: m.status === "eaten" ? "planned" : "eaten" }); route(); } },
          h("div", { class: "kind" }, m.meal, m.shared ? " · both" : ""), h("div", { class: "desc" }, m.description)))
          : h("div", { class: "muted small" }, "–"));
    };
    if (!narrow) return h("div", { class: "week" }, days.map(dayCard));
    const past = days.filter((iso) => iso < d.today), rest = days.filter((iso) => iso >= d.today);
    return h("div", {},
      past.length ? h("details", { class: "more", style: "margin-bottom:8px" }, h("summary", {}, `Earlier this week (${plural(past.length, "day")})`),
        h("div", { class: "week", style: "margin-top:8px" }, past.map(dayCard))) : null,
      h("div", { class: "week" }, rest.map(dayCard)));
  };
  const nextStart = (() => { const dt = new Date(d.week_start + "T12:00:00"); dt.setDate(dt.getDate() + 7); return dt.toISOString().slice(0, 10); })();
  const hasNext = d.meals.some((m) => m.plan_date >= nextStart);
  out.push(card("This week", state.together ? "dinners" : d.protein_target ? `target ${d.protein_target}g protein/day` : null,
    d.meals.some((m) => m.plan_date < nextStart) ? weekGrid(d.week_start) : empty("No plan yet. The agent proposes one Saturday morning.")));
  if (hasNext) out.push(h("div", { style: "height:12px" }), card("Next week", null, weekGrid(nextStart)));

  // groceries
  const cats = {};
  for (const g of d.groceries) (cats[g.category || "other"] ||= []).push(g);
  const open = d.groceries.filter((g) => !g.checked).length;
  const item = h("input", { placeholder: "Add an item", "aria-label": "Grocery item" });
  const cat = h("select", { "aria-label": "Category", style: "flex:0 0 auto;width:auto" },
    ["produce", "protein", "dairy", "pantry", "frozen", "other"].map((c) => h("option", { value: c }, c)));
  const groceries = card("Groceries", `${open} to get`,
    d.groceries.length ? Object.entries(cats).map(([c, items]) => h("div", { style: "margin-bottom:8px" },
      h("div", { class: "muted small", style: "text-transform:capitalize;margin:6px 0 2px" }, c),
      h("ul", { class: "list" }, items.map((g) => h("li", {},
        h("input", { type: "checkbox", class: "check", checked: !!g.checked, "aria-label": g.item, onchange: async (e) => {
          await post(`/api/grocery/${g.id}`, { checked: e.target.checked });
          e.target.nextSibling.classList.toggle("done-text", e.target.checked); } }),
        h("div", { class: `grow${g.checked ? " done-text" : ""}` }, g.item, g.quantity ? h("span", { class: "muted" }, ` · ${g.quantity}`) : null))))))
      : empty("The list builds when you approve the meal plan, or add items here."),
    h("form", { class: "add", onsubmit: async (e) => {
      e.preventDefault(); if (!item.value.trim()) return;
      await post("/api/grocery", { item: item.value, category: cat.value }); toast("Added"); route(); } }, item, cat, h("button", { type: "submit" }, "Add")));
  out.push(h("div", { style: "height:12px" }), groceries);
  return out;
}

async function renderLoops() {
  const d = await api("/api/loops");
  const life = await api("/api/life?together=0").catch(() => null);
  const out = [h("div", { class: "view-head" }, h("h1", {}, "Loops"), h("span", { class: "sub" }, "Is life actually getting better?"))];
  const grid = h("div", { class: "grid cols-2" });
  if (state.together) out.push(h("div", { class: "banner" }, "Together mode: your focus, decisions, and agent stats are hidden."));

  const fr = d.focus_rate || {};
  const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "–");
  if (!state.together) grid.append(card("Daily focus", "the one thing",
    h("div", { class: "stats", style: "margin-top:0;grid-template-columns:repeat(2,1fr)" },
      h("div", { class: "stat" }, h("div", { class: "label" }, "Last 7 days"), h("div", { class: "value" }, pct(fr.done_7d, fr.answered_7d)), h("div", { class: "delta" }, `${fr.done_7d || 0} of ${fr.answered_7d || 0} done`)),
      h("div", { class: "stat" }, h("div", { class: "label" }, "Last 28 days"), h("div", { class: "value" }, pct(fr.done_28d, fr.answered_28d)), h("div", { class: "delta" }, `${fr.done_28d || 0} of ${fr.answered_28d || 0} done`))),
    d.focus.length ? h("ul", { class: "list", style: "margin-top:10px" }, d.focus.slice(0, 7).map((f) => h("li", {},
      h("div", { class: "grow" }, h("div", { class: f.done === 1 ? "done-text" : "" }, f.focus), h("div", { class: "meta" }, fmtDate(f.focus_date))),
      h("span", { class: "pill" }, f.done === 1 ? "done" : f.done === 0 ? "missed" : "–")))) : empty("No focus history yet.")));

  const open = d.decisions.filter((x) => x.status === "open"), reviewed = d.decisions.filter((x) => x.status === "reviewed");
  if (!state.together) grid.append(card("Decision journal", `${open.length} open · ${reviewed.length} reviewed`,
    open.length ? h("ul", { class: "list" }, open.map((x) => h("li", {}, h("div", { class: "grow" },
      h("div", {}, x.title),
      h("div", { class: "meta" }, x.choice ? `Chose: ${x.choice}${x.confidence != null ? ` · ${x.confidence}% confident` : ""}` : "Not decided yet"),
      x.expected_outcome ? h("div", { class: "small", style: "margin-top:3px" }, "Expect: ", x.expected_outcome) : null),
      x.review_on ? h("span", { class: "pill" }, `review ${fmtShort(x.review_on)}`) : null))) : empty("No open decisions."),
    d.calibration.length ? h("div", { class: "table-wrap", style: "margin-top:12px" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Confidence"), h("th", { class: "num" }, "Reviewed"), h("th", { class: "num" }, "Went as expected or better"))),
      h("tbody", {}, d.calibration.map((c) => h("tr", {}, h("td", {}, c.confidence_band), h("td", { class: "num" }, c.reviewed), h("td", { class: "num" }, pct(c.went_as_expected_or_better, c.reviewed)))))))
      : h("p", { class: "muted small", style: "margin:10px 0 0" }, "Calibration shows up after a few decisions are reviewed.")));

  if (!state.together) grid.append(card("Agent engagement", "last 28 days",
    d.engagement.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Routine"), h("th", { class: "num" }, "Sent"), h("th", { class: "num" }, "You replied"))),
      h("tbody", {}, d.engagement.map((r) => h("tr", {}, h("td", {}, r.routine), h("td", { class: "num" }, r.sent_28d), h("td", { class: "num" }, `${fmtNum(r.response_pct)}%`))))))
      : empty("Routine stats appear after the first week."),
    d.changes.length ? h("ul", { class: "list", style: "margin-top:12px" }, d.changes.slice(0, 5).map((c) => h("li", {},
      h("div", { class: "grow" }, h("div", {}, c.change), h("div", { class: "meta" }, c.reason)), h("span", { class: "pill" }, c.status)))) : null));

  if (life) {
    grid.append(card("Together mode", "which areas show",
      h("p", { class: "muted small", style: "margin:0 0 8px" }, "For check-ins with Maddie. This filters what's on screen; it isn't a lock."),
      h("ul", { class: "list" }, life.domains.map((dm) => h("li", {},
        h("input", { type: "checkbox", class: "check", checked: !!dm.shared_view, "aria-label": `Show ${dm.name} in Together mode`, onchange: async (e) => {
          await post(`/api/domains/${dm.id}`, { shared_view: e.target.checked }); toast("Saved"); } }),
        h("div", { class: "grow" }, dm.name))))));
  }
  out.push(grid);
  return out;
}

// ------------------------------------------------------------------ goals: the dials

const PHASE_LABELS = { cut: "Cut", build: "Build", hyrox_block: "HYROX block", taper: "Taper", maintenance: "Maintenance", other: "Other" };
const LEVEL_CLASS = { critical: "bad", warning: "warn", info: "" };

function blockDefaults(today) {
  return { name: "Cut", phase: "cut", start_date: today, end_date: "", priority: 20, direction: "lose", rate_pct: 0.5,
    emphasis: 50, recovery_strictness: "balanced", sessions_per_week: 5, maintenance_kcal: "", calorie_floor: 1800, notes: "" };
}

function dialSlider({ label, left, right, value, min, max, step, fmt, oninput }) {
  const out = h("span", { class: "dial-val" }, fmt(value));
  const input = h("input", { type: "range", min, max, step, value, "aria-label": label,
    oninput: (e) => { out.textContent = fmt(Number(e.target.value)); oninput(Number(e.target.value)); } });
  return h("div", { class: "dial" },
    h("div", { class: "dial-head" }, h("span", {}, label), out),
    input,
    left || right ? h("div", { class: "dial-ends" }, h("span", {}, left), h("span", {}, right)) : null);
}

function segPick(label, options, value, onpick) {
  const wrap = h("div", { class: "seg", role: "group", "aria-label": label });
  const draw = (v) => wrap.replaceChildren(...options.map(([text, val]) =>
    h("button", { type: "button", "aria-pressed": String(v === val), onclick: () => { draw(val); onpick(val); } }, text)));
  draw(value);
  return h("div", { class: "dial" }, h("div", { class: "dial-head" }, h("span", {}, label)), wrap);
}

function skeletonView(sk, conflicts) {
  if (!sk) return empty("Set the dials to see the numbers.");
  const k = (v) => (v == null ? "–" : fmtNum(v));
  return h("div", {},
    h("div", { class: "stats", style: "margin-top:0" },
      h("div", { class: "stat" }, h("div", { class: "label" }, "Hard day"), h("div", { class: "value" }, k(sk.hard_kcal), h("span", { class: "muted small" }, " kcal")),
        h("div", { class: "delta" }, sk.hard_carbs_g != null ? `${k(sk.hard_carbs_g)}g carbs` : "")),
      h("div", { class: "stat" }, h("div", { class: "label" }, "Rest day"), h("div", { class: "value" }, k(sk.rest_kcal), h("span", { class: "muted small" }, " kcal")),
        h("div", { class: "delta" }, sk.rest_carbs_g != null ? `${k(sk.rest_carbs_g)}g carbs` : "")),
      h("div", { class: "stat" }, h("div", { class: "label" }, "Protein"), h("div", { class: "value" }, k(sk.protein_g), h("span", { class: "muted small" }, " g")),
        h("div", { class: "delta" }, sk.fat_g != null ? `fat ${k(sk.fat_g)}g` : ""))),
    h("dl", { class: "kv", style: "margin-top:12px" },
      h("dt", {}, "Weekly mix"), h("dd", {}, `${sk.strength_sessions} strength / ${sk.sessions_per_week - sk.strength_sessions} conditioning`),
      h("dt", {}, "Maintenance"), h("dd", {}, sk.maintenance_used == null ? "not set" : `${k(sk.maintenance_used)} kcal (${sk.maintenance_source})`),
      h("dt", {}, "Daily change"), h("dd", {}, sk.daily_delta == null ? "–" : `${sk.daily_delta > 0 ? "+" : ""}${k(sk.daily_delta)} kcal vs maintenance`),
      h("dt", {}, "Weight (7-day)"), h("dd", {}, sk.weight_avg7 == null ? "no weigh-ins this week" : `${fmtNum(sk.weight_avg7, 1)} lb`)),
    conflictList(conflicts));
}

function conflictList(conflicts) {
  if (!conflicts?.length) return h("p", { class: "small", style: "margin:12px 0 0;color:var(--good-text)" }, "No conflicts. These settings point the same direction.");
  return h("ul", { class: "list", style: "margin-top:12px" }, conflicts.map((c) =>
    h("li", {}, c.level !== "info" ? h("span", { class: `pill ${LEVEL_CLASS[c.level]}` }, c.level === "critical" ? "check" : "tradeoff") : h("span", { class: "pill" }, "note"),
      h("div", { class: "grow small" }, c.message))));
}

function blockEditor(start, { isNew, today, onSaved }) {
  const v = { ...start };
  for (const k of ["end_date", "maintenance_kcal", "notes"]) if (v[k] == null) v[k] = "";
  const preview = h("div", {});
  const summary = h("p", { class: "small", style: "margin:4px 0 0" });
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const r = await fetch("/api/blocks/preview", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...v, id: isNew ? null : v.id }) });
        const d = await r.json();
        preview.replaceChildren(r.ok ? skeletonView(d.skeleton, d.conflicts) : empty(d.error || "Couldn't preview"));
        const sk = r.ok ? d.skeleton : null;
        summary.textContent = sk && sk.hard_kcal != null
          ? `Hard ${fmtNum(sk.hard_kcal)} · rest ${fmtNum(sk.rest_kcal)} kcal · ${fmtNum(sk.protein_g)}g protein${d.conflicts.some((c) => c.level !== "info") ? " · see tradeoffs" : ""}`
          : "";
      } catch { preview.replaceChildren(empty("Couldn't preview")); }
    }, 250);
  };
  const set = (k) => (val) => { v[k] = val; refresh(); };
  const field = (label, input) => h("label", { class: "field-row" }, h("span", {}, label), input);
  const text = (k, attrs = {}) => h("input", { class: "field", value: v[k] ?? "", ...attrs, oninput: (e) => set(k)(e.target.value) });

  let rate = null;
  const rateWrap = h("div", {});
  const drawRate = () => {
    rate = v.direction === "maintain" ? null : dialSlider({ label: "Rate", left: "slower", right: "faster",
      value: v.direction === "gain" ? Math.min(v.rate_pct || 0.25, 0.5) : (v.rate_pct || 0.5), min: 0.1, max: v.direction === "gain" ? 0.5 : 1, step: 0.05,
      fmt: (x) => `${x.toFixed(2)}% of body weight / week`, oninput: set("rate_pct") });
    if (v.direction === "gain" && v.rate_pct > 0.5) v.rate_pct = 0.5;
    if (v.direction !== "maintain" && !v.rate_pct) v.rate_pct = v.direction === "gain" ? 0.25 : 0.5;
    rateWrap.replaceChildren(rate || h("p", { class: "muted small", style: "margin:0" }, "Maintaining: no planned weight change."));
  };
  drawRate();

  const form = h("div", { class: "dials" },
    h("div", { class: "field-grid" },
      field("Name", text("name", { placeholder: "Cut, part 2" })),
      field("Phase", h("select", { class: "field", onchange: (e) => set("phase")(e.target.value) },
        Object.entries(PHASE_LABELS).map(([val, lab]) => h("option", { value: val, selected: v.phase === val }, lab)))),
      field("Starts", text("start_date", { type: "date" })),
      field("Ends", text("end_date", { type: "date" }))),
    dialSlider({ label: "Priority", left: "Body composition", right: "Performance", value: v.priority, min: 0, max: 100, step: 5,
      fmt: (x) => (x < 40 ? "body comp-led" : x > 60 ? "performance-led" : "balanced") + ` (${x})`, oninput: set("priority") }),
    segPick("Direction", [["Lose fat", "lose"], ["Maintain", "maintain"], ["Gain muscle", "gain"]], v.direction,
      (val) => { v.direction = val; drawRate(); refresh(); }),
    rateWrap,
    dialSlider({ label: "Training emphasis", left: "Strength", right: "Engine", value: v.emphasis, min: 0, max: 100, step: 5,
      fmt: (x) => (x < 40 ? "strength" : x > 60 ? "engine" : "hybrid") + ` (${x})`, oninput: set("emphasis") }),
    segPick("Recovery strictness", [["Conservative", "conservative"], ["Balanced", "balanced"], ["Aggressive", "aggressive"]], v.recovery_strictness, set("recovery_strictness")),
    h("div", { class: "field-grid" },
      field("Sessions per week", text("sessions_per_week", { type: "number", min: 1, max: 7, inputmode: "numeric" })),
      field("Maintenance guess (kcal)", text("maintenance_kcal", { type: "number", min: 1000, max: 6000, step: 50, inputmode: "numeric", placeholder: "e.g. 2800" })),
      field("Calorie floor (kcal)", text("calorie_floor", { type: "number", min: 1200, max: 4000, step: 50, inputmode: "numeric" }))),
    h("p", { class: "muted small", style: "margin:4px 0 0" }, "The maintenance guess is replaced by a learned estimate once there are 2–3 weeks of logged meals and weigh-ins."),
    summary,
    h("div", { style: "display:flex;gap:8px;margin-top:12px;flex-wrap:wrap" },
      h("button", { class: "btn", type: "button", onclick: async () => {
        const r = await post(isNew ? "/api/blocks" : `/api/blocks/${v.id}`, v);
        toast(isNew ? "Block started" : "Dials saved"); onSaved?.(r.id); } }, isNew ? "Start this block" : "Save dials")));
  refresh();
  return { form, preview };
}

async function renderGoals() {
  if (state.together) return [h("div", { class: "view-head" }, h("h1", {}, "Goals")), h("div", { class: "banner" }, "Goals are private in Together mode.")];
  const d = await api("/api/goals");
  const out = [h("div", { class: "view-head" }, h("h1", {}, "Goals"), h("span", { class: "sub" }, "The dials the agent works inside"))];
  if (d.missing) return [...out, card("Not installed yet", null, empty("Run update.sh on the server to add training blocks."))];

  const editingNew = state.newBlock || !d.active;
  const base = editingNew ? blockDefaults(d.today) : d.active;
  const ed = blockEditor(base, { isNew: editingNew, today: d.today, onSaved: () => { state.newBlock = false; route(); } });
  const head = editingNew
    ? (d.active ? "New block" : "Set up your first block")
    : `${d.active.name} · ${PHASE_LABELS[d.active.phase] || d.active.phase}`;
  const aside = editingNew ? (d.active ? "saving ends the current block" : null)
    : `since ${fmtShort(d.active.start_date)}${d.active.end_date ? ` · until ${fmtShort(d.active.end_date)}` : ""}`;

  const top = h("div", { class: "grid cols-2" });
  top.append(card(head, aside, ed.form,
    !editingNew ? h("button", { class: "btn ghost small", type: "button", style: "margin-top:10px", onclick: () => { state.newBlock = true; route(); } }, "Start a new block")
      : d.active ? h("button", { class: "btn ghost small", type: "button", style: "margin-top:10px", onclick: () => { state.newBlock = false; route(); } }, "Cancel") : null));
  top.append(card("What the dials produce", "updates as you move them", ed.preview));
  out.push(top);

  const grid = h("div", { class: "grid cols-3", style: "margin-top:12px" });
  const day = d.day;
  grid.append(card("Today", day ? (day.day_type ? `${day.day_type} day` : null) : null,
    day ? [h("div", { class: "stats", style: "margin-top:0" },
      h("div", { class: "stat" }, h("div", { class: "label" }, "Calories"), h("div", { class: "value" }, fmtNum(day.kcal))),
      h("div", { class: "stat" }, h("div", { class: "label" }, "Protein"), h("div", { class: "value" }, fmtNum(day.protein_g), h("span", { class: "muted small" }, " g"))),
      h("div", { class: "stat" }, h("div", { class: "label" }, "Carbs"), h("div", { class: "value" }, fmtNum(day.carbs_g), h("span", { class: "muted small" }, " g")))),
      h("dl", { class: "kv", style: "margin-top:12px" },
        h("dt", {}, "Recovery"), h("dd", {}, day.recovery == null ? "not scored" : `${fmtNum(day.recovery)}%`),
        h("dt", {}, "Gate"), h("dd", {}, (day.gate || "–").replace("_", " ")),
        day.session_change ? [h("dt", {}, "Session"), h("dd", {}, day.session_change)] : null)]
      : empty("Set by the pre-session message once WHOOP scores your recovery.")));

  const m = d.maintenance || {};
  grid.append(card("Learned maintenance", m.ready ? "ready" : "building",
    m.ready ? [h("div", { class: "hero" }, h("div", {}, h("span", { class: "big", style: "font-size:36px" }, fmtNum(m.estimate_kcal)), h("span", { class: "unit" }, " kcal"))),
      h("dl", { class: "kv", style: "margin-top:12px" },
        h("dt", {}, "Avg intake"), h("dd", {}, `${fmtNum(m.avg_intake)} kcal over ${m.intake_days} logged days`),
        h("dt", {}, "Weight trend"), h("dd", {}, `${fmtNum(m.weight_early, 1)} → ${fmtNum(m.weight_late, 1)} lb (${m.lb_per_week > 0 ? "+" : ""}${fmtNum(m.lb_per_week, 2)}/wk)`)),
      h("p", { class: "muted small", style: "margin:8px 0 0" }, "Under-logging makes this read low.")]
      : empty(`Needs 14 logged days in the last 3 weeks and weigh-ins at both ends. ${m.intake_days || 0} logged days so far.`)));

  grid.append(card("This week's plan", d.planned.length ? plural(d.planned.length, "session") : null,
    d.planned.length ? h("ul", { class: "list" }, d.planned.map((p) => {
      let km = [];
      try { km = JSON.parse(p.key_measures || "[]"); } catch {}
      return h("li", {}, h("div", { class: "grow" },
        h("div", {}, p.title, p.key_session ? h("span", { class: "pill", style: "margin-left:6px" }, "key") : null),
        h("div", { class: "meta" }, [fmtDate(p.plan_date), p.session_type, p.source !== "agent" ? p.source : null, p.status !== "planned" ? p.status : null].filter(Boolean).join(" · ")),
        km.length ? h("div", { class: "small muted", style: "margin-top:2px" }, "Ask: ", km.map((x) => x.measure).join(", ")) : null));
    })) : empty("No sessions planned for the next 7 days.")));
  out.push(grid);

  const g2 = h("div", { class: "grid cols-2", style: "margin-top:12px" });
  g2.append(card("Sessions", "check-ins and load",
    d.sessions.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Session"), h("th", {}, "Check-in"), h("th", { class: "num" }, "RPE"), h("th", { class: "num" }, "Load"), h("th", { class: "num" }, "Strain"))),
      h("tbody", {}, d.sessions.map((w) => h("tr", {},
        h("td", {}, h("div", {}, w.planned_title || w.session_type || w.sport || "Workout"), h("div", { class: "muted small" }, fmtDate(w.workout_date))),
        h("td", {}, w.checkin_status ? w.checkin_status.replace("_", " ") : h("span", { class: "muted" }, "–")),
        h("td", { class: "num" }, fmtNum(w.rpe)), h("td", { class: "num" }, fmtNum(w.srpe_load)), h("td", { class: "num" }, fmtNum(w.strain, 1)))))))
      : empty("Workouts from WHOOP show here with their check-ins."),
    h("p", { class: "muted small", style: "margin:8px 0 0" }, "Load = session RPE × minutes. When it disagrees with strain, that's a readiness signal.")));
  g2.append(card("Key measures", "actual vs. target",
    d.measures.length ? h("div", { class: "table-wrap" }, h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Measure"), h("th", { class: "num" }, "Target"), h("th", { class: "num" }, "Actual"))),
      h("tbody", {}, d.measures.map((x) => h("tr", {},
        h("td", {}, h("div", {}, x.measure), h("div", { class: "muted small" }, `${fmtDate(x.measure_date)}${x.unit ? ` · ${x.unit}` : ""}`)),
        h("td", { class: "num" }, fmtNum(x.target, 1)), h("td", { class: "num" }, fmtNum(x.actual, 1)))))))
      : empty("Filled from post-workout check-ins.")));
  out.push(g2);

  const charts = h("div", { class: "charts", style: "margin-top:12px" },
    chartCard({ title: "Body weight", points: d.weight, unit: "lb", decimals: 1, note: "Daily weigh-ins; read the 7-day average, not single days." }),
    chartCard({ title: "Skinfold sum", points: d.skinfolds, unit: "mm", decimals: 1, weekly: true,
      note: d.skinfolds.length ? `Latest: ${d.skinfolds.at(-1).detail}. Same sites, same conditions, weekly.` : "Log weekly caliper readings by site; the sum is the trend." }));
  out.push(charts);

  out.push(h("div", { style: "height:12px" }), card("Rules changelog", "one change at a time",
    h("ul", { class: "list" }, d.rules.map((r) => h("li", {}, h("span", { class: "pill" }, `v${r.version}`),
      h("div", { class: "grow" }, h("div", { class: "small" }, r.change), h("div", { class: "meta" }, `${fmtDate(r.effective_date)}${r.reason ? ` · ${r.reason}` : ""}`)))))));
  return out;
}

// ------------------------------------------------------------------ router

const VIEWS = { today: renderToday, health: renderHealth, goals: renderGoals, life: renderLife, food: renderFood, loops: renderLoops };

async function route() {
  const tab = TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "today";
  document.querySelectorAll("[data-tab]").forEach((a) => a.dataset.tab === tab ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  $tip.hidden = true;
  $view.classList.add("loading");
  try {
    const nodes = await VIEWS[tab]();
    $view.replaceChildren(...nodes);
  } catch (e) {
    $view.replaceChildren(card("Couldn't load", null, empty(String(e.message || e))));
  } finally {
    $view.classList.remove("loading");
  }
}

$together.addEventListener("change", () => { state.together = $together.checked; store.set("together", state.together); route(); });
window.addEventListener("hashchange", route);
document.addEventListener("visibilitychange", () => { if (!document.hidden) route(); });
document.addEventListener("scroll", () => ($tip.hidden = true), { passive: true });
route();
