#!/usr/bin/env python3
"""
WHOOP -> life CRM sync. Standard library only.

  python3 whoop.py auth            one-time: connect your WHOOP account
  python3 whoop.py sync [--days N] pull recent recovery, sleep, strain, and workouts into the database
  python3 whoop.py status          show connection and last-sync info

Secrets live in ~/life-agent/secrets/ (owner-only permissions). Never commit or share that folder.
"""
import argparse
import datetime as dt
import fcntl
import json
import os
import secrets as pysecrets
import sqlite3
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

AGENT_DIR = os.environ.get("AGENT_DIR", os.path.expanduser("~/life-agent"))
SECRETS_DIR = os.path.join(AGENT_DIR, "secrets")
CLIENT_FILE = os.path.join(SECRETS_DIR, "whoop-client.json")
TOKEN_FILE = os.path.join(SECRETS_DIR, "whoop-tokens.json")
LOCK_FILE = os.path.join(SECRETS_DIR, ".whoop.lock")
DB_PATH = os.path.join(AGENT_DIR, "db", "life.db")
LOG_PATH = os.path.join(AGENT_DIR, "log", "whoop-sync.log")

API_HOST = os.environ.get("WHOOP_API_HOST", "https://api.prod.whoop.com")
AUTH_URL = API_HOST + "/oauth/oauth2/auth"
TOKEN_URL = API_HOST + "/oauth/oauth2/token"
API_BASE = API_HOST + "/developer/v2"
REDIRECT_URI = os.environ.get("WHOOP_REDIRECT_URI", "http://localhost:3000/callback")
SCOPES = "offline read:recovery read:cycles read:sleep read:workout read:body_measurement"

try:
    LOCAL_TZ = ZoneInfo(os.environ.get("LIFE_AGENT_TZ", "America/Indiana/Indianapolis"))
except Exception:
    LOCAL_TZ = None  # fall back to the server's own timezone (set to Indianapolis during setup)
SOURCE = "whoop_api"


# ---------------------------------------------------------------- helpers

def log(msg):
    line = f"{dt.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line)
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def write_secret(path, data):
    os.makedirs(SECRETS_DIR, mode=0o700, exist_ok=True)
    os.chmod(SECRETS_DIR, 0o700)
    tmp = path + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
    os.replace(tmp, path)


def read_json(path):
    with open(path) as f:
        return json.load(f)


def http(method, url, data=None, headers=None):
    body = None
    headers = dict(headers or {})
    headers.setdefault("User-Agent", "life-agent-whoop-sync/1.0")
    if data is not None:
        body = urllib.parse.urlencode(data).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 3:
                wait = int(e.headers.get("Retry-After", "20"))
                log(f"Rate limited; waiting {wait}s")
                time.sleep(min(wait, 60))
                continue
            detail = e.read().decode(errors="replace")[:300]
            raise RuntimeError(f"HTTP {e.code} from {urllib.parse.urlsplit(url).path}: {detail}") from None
        except urllib.error.URLError as e:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise RuntimeError(f"Network error reaching WHOOP: {e.reason}") from None


def parse_ts(s):
    if not s:
        return None
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def local_date(ts):
    t = parse_ts(ts)
    if not t:
        return None
    return (t.astimezone(LOCAL_TZ) if LOCAL_TZ else t.astimezone()).date().isoformat()


# ---------------------------------------------------------------- auth

def cmd_auth(_args):
    print("Connect WHOOP to your life agent.\n")
    print(f"In the WHOOP developer dashboard, your app's redirect URI must be exactly:\n  {REDIRECT_URI}\n")
    if os.path.exists(CLIENT_FILE) and input("Client ID/secret already saved. Reuse them? [Y/n] ").strip().lower() != "n":
        client = read_json(CLIENT_FILE)
    else:
        client = {
            "client_id": input("Client ID: ").strip(),
            "client_secret": input("Client Secret: ").strip(),
        }
        if not client["client_id"] or not client["client_secret"]:
            sys.exit("Both are required.")
        write_secret(CLIENT_FILE, client)

    state = pysecrets.token_hex(8)  # 16 characters
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "response_type": "code",
        "client_id": client["client_id"],
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPES,
        "state": state,
    })
    print("\n1. Open this link in a browser on your laptop or phone and approve access:\n")
    print(url)
    print("\n2. WHOOP will send you to a localhost page that won't load. That's expected.")
    print("   Copy the FULL address from the browser's address bar (it contains ?code=...).")
    pasted = input("\n3. Paste it here: ").strip()

    q = urllib.parse.parse_qs(urllib.parse.urlsplit(pasted).query)
    if "error" in q:
        sys.exit(f"WHOOP returned an error: {q.get('error_description', q['error'])[0]}")
    if q.get("state", [""])[0] != state:
        sys.exit("That URL doesn't match this sign-in attempt (state mismatch). Run auth again and use the newest link.")
    code = q.get("code", [""])[0]
    if not code:
        sys.exit("No code found in that URL. Make sure you copied the whole address.")

    tok = http("POST", TOKEN_URL, data={
        "grant_type": "authorization_code",
        "code": code,
        "client_id": client["client_id"],
        "client_secret": client["client_secret"],
        "redirect_uri": REDIRECT_URI,
    })
    save_tokens(tok)
    if not tok.get("refresh_token"):
        print("\nWarning: WHOOP didn't return a refresh token. Check that the 'offline' scope is enabled on your app.")
    print("\nConnected. Now run:  python3 ~/life-agent/scripts/whoop.py sync --days 30")


def save_tokens(tok, previous=None):
    previous = previous or {}
    data = {
        "access_token": tok["access_token"],
        # WHOOP rotates refresh tokens: always keep the newest one.
        "refresh_token": tok.get("refresh_token") or previous.get("refresh_token"),
        "expires_at": int(time.time()) + int(tok.get("expires_in", 3600)),
        "scope": tok.get("scope", previous.get("scope", "")),
        "updated_at": dt.datetime.now().isoformat(timespec="seconds"),
    }
    write_secret(TOKEN_FILE, data)
    return data


def access_token():
    """Return a valid access token, refreshing under a lock if needed."""
    if not os.path.exists(TOKEN_FILE):
        raise RuntimeError("WHOOP isn't connected yet. Run: python3 ~/life-agent/scripts/whoop.py auth")
    os.makedirs(SECRETS_DIR, mode=0o700, exist_ok=True)
    with open(LOCK_FILE, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)  # one refresh at a time; rotated tokens can't be reused
        tok = read_json(TOKEN_FILE)
        if tok.get("expires_at", 0) - time.time() > 300:
            return tok["access_token"]
        if not tok.get("refresh_token"):
            raise RuntimeError("Access expired and no refresh token is saved. Run auth again.")
        client = read_json(CLIENT_FILE)
        try:
            new = http("POST", TOKEN_URL, data={
                "grant_type": "refresh_token",
                "refresh_token": tok["refresh_token"],
                "client_id": client["client_id"],
                "client_secret": client["client_secret"],
                "scope": "offline",
            })
        except RuntimeError as e:
            raise RuntimeError(f"Token refresh failed ({e}). If this keeps happening, run auth again.") from None
        return save_tokens(new, previous=tok)["access_token"]


# ---------------------------------------------------------------- fetch

def fetch_all(path, start, end):
    token = access_token()
    records, next_token = [], None
    while True:
        params = {"start": start, "end": end, "limit": 25}
        if next_token:
            params["nextToken"] = next_token
        page = http("GET", f"{API_BASE}{path}?{urllib.parse.urlencode(params)}",
                    headers={"Authorization": f"Bearer {token}"})
        records.extend(page.get("records", []))
        next_token = page.get("next_token")
        if not next_token:
            return records


# ---------------------------------------------------------------- transform

def recovery_rows(records, sleep_end_by_id):
    """Rows for each scored recovery, plus a map of cycle id -> the day that cycle belongs to."""
    rows, day_by_cycle = [], {}
    for r in records:
        if r.get("score_state") != "SCORED" or not r.get("score"):
            continue  # pending or unscorable: never record as zero
        s = r["score"]
        # A recovery belongs to the morning you woke up: use the linked sleep's end, else created_at.
        day = sleep_end_by_id.get(str(r.get("sleep_id"))) or local_date(r.get("created_at"))
        if not day:
            continue
        if r.get("cycle_id") is not None:
            day_by_cycle[str(r["cycle_id"])] = day
        for key, val in (("whoop_recovery", s.get("recovery_score")),
                         ("whoop_hrv", s.get("hrv_rmssd_milli")),
                         ("resting_hr", s.get("resting_heart_rate")),
                         ("skin_temp_c", s.get("skin_temp_celsius"))):  # WHOOP 4.0+; absent on older straps
            if val is not None:
                rows.append((day, key, round(float(val), 1)))
    return rows, day_by_cycle


def sleep_rows(records):
    rows, end_by_id = [], {}
    for r in records:
        if r.get("nap"):
            continue
        day = local_date(r.get("end"))
        if not day:
            continue
        end_by_id[str(r.get("id"))] = day
        if r.get("score_state") != "SCORED" or not r.get("score"):
            continue
        s = r["score"]
        if s.get("respiratory_rate") is not None:
            rows.append((day, "respiratory_rate", round(float(s["respiratory_rate"]), 1)))
        if s.get("sleep_performance_percentage") is not None:
            rows.append((day, "whoop_sleep_perf", round(float(s["sleep_performance_percentage"]), 1)))
        st = s.get("stage_summary") or {}
        asleep_ms = sum(st.get(k) or 0 for k in ("total_light_sleep_time_milli",
                                                 "total_slow_wave_sleep_time_milli",
                                                 "total_rem_sleep_time_milli"))
        if asleep_ms:
            rows.append((day, "whoop_sleep_hours", round(asleep_ms / 3_600_000, 2)))
    return rows, end_by_id


def cycle_day(c, day_by_cycle):
    """The day a cycle's strain and calories belong to.

    A WHOOP cycle starts when you fall asleep (usually the evening before) and runs until the next
    sleep, so its start date is normally the previous day. The cycle belongs to the day you were
    awake in it: the same day as the recovery scored for it. Without a recovery, use the start
    plus 12 hours (sleep onset at 10:30pm -> 10:30am the next day; at 1am -> 1pm the same day).
    """
    day = day_by_cycle.get(str(c.get("id")))
    if day:
        return day
    t = parse_ts(c.get("start"))
    if not t:
        return None
    t = t + dt.timedelta(hours=12)
    return (t.astimezone(LOCAL_TZ) if LOCAL_TZ else t.astimezone()).date().isoformat()


def cycle_rows(records, day_by_cycle=None):
    rows = []
    for c in records:
        if c.get("score_state") != "SCORED" or not c.get("score"):
            continue
        day = cycle_day(c, day_by_cycle or {})
        if not day:
            continue
        s = c["score"]
        if s.get("strain") is not None:
            rows.append((day, "whoop_strain", round(float(s["strain"]), 1)))
        if s.get("kilojoule") is not None:
            rows.append((day, "calories_burned", round(float(s["kilojoule"]) / 4.184)))
    return rows


def local_dt(ts):
    t = parse_ts(ts)
    if not t:
        return None
    return (t.astimezone(LOCAL_TZ) if LOCAL_TZ else t.astimezone()).strftime("%Y-%m-%d %H:%M")


def pct(v):
    """WHOOP reports percent_recorded as a 0-1 fraction; store it as 0-100 so 'under 80' means what it says."""
    if v is None:
        return None
    v = float(v)
    return round(v * 100, 1) if v <= 1 else round(v, 1)


def workout_rows(records):
    """One dict per scored workout, ready for the workouts table."""
    rows = []
    for w in records:
        if w.get("score_state") != "SCORED" or not w.get("score") or not w.get("id"):
            continue
        s = w["score"]
        start, end = parse_ts(w.get("start")), parse_ts(w.get("end"))
        z = s.get("zone_durations") or {}
        mins = lambda k: round((z.get(k) or 0) / 60000, 1) if z else None
        kj = s.get("kilojoule")
        rows.append({
            "whoop_id": str(w["id"]),
            "workout_date": local_date(w.get("start")),
            "start_at": local_dt(w.get("start")),
            "end_at": local_dt(w.get("end")),
            "sport": (w.get("sport_name") or "").strip().lower() or None,
            "duration_min": round((end - start).total_seconds() / 60, 1) if start and end else None,
            "strain": round(float(s["strain"]), 1) if s.get("strain") is not None else None,
            "avg_hr": s.get("average_heart_rate"),
            "max_hr": s.get("max_heart_rate"),
            "kcal": round(float(kj) / 4.184) if kj is not None else None,
            "distance_m": s.get("distance_meter"),
            "percent_recorded": pct(s.get("percent_recorded")),
            "z0_min": mins("zone_zero_milli"), "z1_min": mins("zone_one_milli"),
            "z2_min": mins("zone_two_milli"), "z3_min": mins("zone_three_milli"),
            "z4_min": mins("zone_four_milli"), "z5_min": mins("zone_five_milli"),
        })
    return [r for r in rows if r["workout_date"]]


# ---------------------------------------------------------------- store

def store(rows):
    """Replace WHOOP values for each (day, metric): API data wins over earlier screenshots."""
    con = sqlite3.connect(DB_PATH, timeout=30)
    try:
        with con:
            for day, key, val in rows:
                con.execute(
                    "DELETE FROM metrics WHERE measured_on=? AND metric_key=? AND source IN ('whoop_api','whoop_screenshot')",
                    (day, key))
                con.execute(
                    "INSERT INTO metrics (measured_on, metric_key, value, source) VALUES (?,?,?,?)",
                    (day, key, val, SOURCE))
    finally:
        con.close()


WORKOUT_COLS = ["workout_date", "start_at", "end_at", "sport", "duration_min", "strain", "avg_hr",
                "max_hr", "kcal", "distance_m", "percent_recorded",
                "z0_min", "z1_min", "z2_min", "z3_min", "z4_min", "z5_min"]


def store_workouts(rows):
    """Upsert by WHOOP id. WHOOP fields refresh; the agent's fields (type, RPE, notes, verdict) are kept."""
    con = sqlite3.connect(DB_PATH, timeout=30)
    try:
        if not con.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='workouts'").fetchone():
            return None  # migration 005 not applied yet
        cols = ["whoop_id"] + WORKOUT_COLS
        sql = (f"INSERT INTO workouts ({', '.join(cols)}, source) VALUES ({', '.join('?' * len(cols))}, '{SOURCE}') "
               f"ON CONFLICT(whoop_id) DO UPDATE SET "
               + ", ".join(f"{c}=excluded.{c}" for c in WORKOUT_COLS)
               + ", synced_at=datetime('now','localtime')")
        with con:
            for r in rows:
                con.execute(sql, [r[c] for c in cols])
        return len(rows)
    finally:
        con.close()


def cmd_sync(args):
    end = dt.datetime.now(dt.timezone.utc)
    start = end - dt.timedelta(days=args.days)
    iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    try:
        sleeps = fetch_all("/activity/sleep", iso(start), iso(end))
        s_rows, end_by_id = sleep_rows(sleeps)
        recs = fetch_all("/recovery", iso(start), iso(end))
        r_rows, day_by_cycle = recovery_rows(recs, end_by_id)
        cycles = fetch_all("/cycle", iso(start), iso(end))
        c_rows = cycle_rows(cycles, day_by_cycle)
        workouts = fetch_all("/activity/workout", iso(start), iso(end))
        w_rows = workout_rows(workouts)
    except RuntimeError as e:
        log(f"SYNC FAILED: {e}")
        sys.exit(1)

    rows = s_rows + r_rows + c_rows
    store(rows)
    stored_w = store_workouts(w_rows)
    w_note = f"{len(w_rows)} workouts" if stored_w is not None else "workouts skipped (run update.sh to add the table)"
    days = sorted({d for d, _, _ in rows})
    log(f"SYNC OK: {len(rows)} values over {len(days)} days "
        f"({len(sleeps)} sleeps, {len(recs)} recoveries, {len(cycles)} cycles, {w_note}); "
        f"latest day {days[-1] if days else 'none'}")


def cmd_status(_args):
    print(f"Client saved: {'yes' if os.path.exists(CLIENT_FILE) else 'no'}")
    if os.path.exists(TOKEN_FILE):
        tok = read_json(TOKEN_FILE)
        left = int(tok.get('expires_at', 0) - time.time())
        print(f"Connected: yes (access token {'valid ' + str(left // 60) + ' min' if left > 0 else 'expired, will refresh on next sync'}; "
              f"refresh token {'saved' if tok.get('refresh_token') else 'MISSING'})")
    else:
        print("Connected: no. Run auth.")
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH) as f:
            lines = [l.rstrip() for l in f if l.strip()]
        print("Last sync: " + (lines[-1] if lines else "never"))


def main():
    p = argparse.ArgumentParser(description="WHOOP sync for the life agent")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("auth")
    s = sub.add_parser("sync")
    s.add_argument("--days", type=int, default=3, help="how many days back to pull (default 3)")
    sub.add_parser("status")
    args = p.parse_args()
    {"auth": cmd_auth, "sync": cmd_sync, "status": cmd_status}[args.cmd](args)


if __name__ == "__main__":
    main()
