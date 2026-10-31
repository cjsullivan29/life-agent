// Life dashboard. Vanilla JS, no build step. All data from /api/* on the same server.

const $view = document.getElementById("view");
const $tip = document.getElementById("tooltip");
const $toast = document.getElementById("toast");
const $together = document.getElementById("together");
const TABS = ["today", "health", "life", "food", "loops"];

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  together: store.get("together", false),
  days: store.get("healthDays", 30),
  domain: null,
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

function chartCard({ title, points, unit, decimals = 0, kind, target, targetLabel, colorFor, note, betterUp = true, extra }) {
  const last = points.at(-1);
  const recent = points.slice(-7).map((p) => p.value), prior = points.slice(-14, -7).map((p) => p.value);
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const a7 = avg(recent), p7 = avg(prior);
  let delta = null;
  if (a7 != null && p7 != null && prior.length >= 3) {
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

// ------------------------------------------------------------------ router

const VIEWS = { today: renderToday, health: renderHealth, life: renderLife, food: renderFood, loops: renderLoops };

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
