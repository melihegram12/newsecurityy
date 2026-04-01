import os
import re
import sys
import json
import sqlite3
from datetime import datetime

import requests


def load_env(path):
    data = {}
    if not os.path.exists(path):
        return data
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            data[key.strip()] = value.strip()
    return data


def print_section(title):
    print("")
    print("=" * 72)
    print(title)
    print("=" * 72)


def ok(label, detail=""):
    print(f"[OK]   {label}{(' - ' + detail) if detail else ''}")


def warn(label, detail=""):
    print(f"[WARN] {label}{(' - ' + detail) if detail else ''}")


def fail(label, detail=""):
    print(f"[FAIL] {label}{(' - ' + detail) if detail else ''}")


def normalize_url(value):
    if not value:
        return ""
    return value.rstrip("/")


def check_env(env):
    print_section("ENV CHECK")
    required = [
        "REACT_APP_SUPABASE_URL",
        "REACT_APP_SUPABASE_ANON_KEY",
        "REACT_APP_LOCAL_SYNC_ENABLED",
        "REACT_APP_LOCAL_API_URL",
        "REACT_APP_LOCAL_API_KEY",
    ]
    missing = [k for k in required if k not in env]
    for k in required:
        if k in env:
            ok(f"{k} present")
        else:
            fail(f"{k} missing")
    return missing


def check_local_api(env):
    print_section("LOCAL API CHECK")
    base = normalize_url(env.get("REACT_APP_LOCAL_API_URL") or env.get("VITE_LOCAL_API_URL"))
    key = env.get("REACT_APP_LOCAL_API_KEY") or env.get("VITE_LOCAL_API_KEY") or ""
    if not base:
        fail("Local API URL missing")
        return False

    url = f"{base}/logs?days=1&limit=1"
    headers = {}
    if key:
        headers["X-Api-Key"] = key
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            ok("Local API reachable", f"{resp.status_code}")
            return True
        fail("Local API error", f"{resp.status_code} {resp.text[:200]}")
        return False
    except Exception as exc:
        fail("Local API unreachable", str(exc))
        return False


def check_supabase(env):
    print_section("SUPABASE CHECK")
    base = normalize_url(env.get("REACT_APP_SUPABASE_URL") or env.get("VITE_SUPABASE_URL"))
    key = env.get("REACT_APP_SUPABASE_ANON_KEY") or env.get("VITE_SUPABASE_ANON_KEY") or ""
    if not base or not key:
        fail("Supabase env missing", "URL or anon key")
        return False

    url = f"{base}/rest/v1/security_logs?select=created_at&limit=1"
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            ok("Supabase reachable", f"{resp.status_code}")
            return True
        fail("Supabase error", f"{resp.status_code} {resp.text[:200]}")
        return False
    except Exception as exc:
        fail("Supabase unreachable", str(exc))
        return False


def check_local_db():
    print_section("LOCAL DB CHECK")
    appdata = os.environ.get("APPDATA", "")
    db_path = os.path.join(appdata, "newsecurityy", "security_panel.db")
    if not os.path.exists(db_path):
        fail("Local DB missing", db_path)
        return False

    try:
        con = sqlite3.connect(db_path)
        cur = con.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cur.fetchall()]
        ok("DB tables", ", ".join(tables) if tables else "none")

        cur.execute("SELECT COUNT(*) FROM security_logs")
        total = cur.fetchone()[0]
        ok("security_logs count", str(total))

        cur.execute("SELECT created_at FROM security_logs")
        created_at_rows = [r[0] for r in cur.fetchall()]

        cur.execute(
            """
            SELECT COUNT(*)
            FROM security_logs
            WHERE exit_at IS NOT NULL
              AND datetime(created_at) > datetime(exit_at)
            """
        )
        reversed_count = cur.fetchone()[0]

        # Allow ISO with microseconds or milliseconds and timezone/Z
        iso_re = re.compile(
            r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$"
        )
        bad = [r for r in created_at_rows if r and not iso_re.match(r)]
        if bad:
            warn("created_at non-ISO", str(len(bad)))
        else:
            ok("created_at format", "all ISO")

        # duplicates by exact string
        from collections import Counter
        cnt = Counter(created_at_rows)
        dup_count = sum(1 for v in cnt.values() if v > 1)
        if dup_count:
            warn("created_at duplicates", str(dup_count))
        else:
            ok("created_at duplicates", "none")

        if reversed_count:
            warn("created_at after exit_at", str(reversed_count))
        else:
            ok("created_at after exit_at", "none")

        con.close()
        return True
    except Exception as exc:
        fail("Local DB error", str(exc))
        return False


def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    env_path = os.path.join(repo_root, ".env")
    env = load_env(env_path)

    missing_env = check_env(env)
    local_api_ok = check_local_api(env)
    supabase_ok = check_supabase(env)
    db_ok = check_local_db()

    print_section("SUMMARY")
    summary = {
        "env_missing": missing_env,
        "local_api_ok": local_api_ok,
        "supabase_ok": supabase_ok,
        "local_db_ok": db_ok,
    }
    print(json.dumps(summary, indent=2))

    if missing_env:
        sys.exit(2)
    if not local_api_ok or not supabase_ok:
        sys.exit(2)
    if not db_ok:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
