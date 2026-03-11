#!/usr/bin/env python3
"""
Sync security logs from local API to Supabase in a date range.

Default range is aligned with the imported backfill window:
  2026-02-05 .. 2026-02-19
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

import requests


SYNC_FIELDS = [
    "event_type",
    "type",
    "sub_category",
    "shift",
    "plate",
    "driver",
    "name",
    "host",
    "note",
    "location",
    "seal_number",
    "seal_number_entry",
    "seal_number_exit",
    "tc_no",
    "phone",
    "user_email",
    "created_at",
    "exit_at",
]


def load_env(env_path: Path) -> Dict[str, str]:
    env: Dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, v = s.split("=", 1)
        env[k.strip()] = v.strip()
    return env


def parse_iso(value: str) -> dt.datetime | None:
    if not value:
        return None
    s = value.strip()
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return dt.datetime.fromisoformat(s)
    except ValueError:
        return None


def to_utc_iso(value: str) -> str:
    parsed = parse_iso(value)
    if not parsed:
        return ""
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc).isoformat()


def canonical_created_at(value: str) -> str:
    iso = to_utc_iso(value)
    if not iso:
        return ""
    return iso


def fetch_local_logs(local_base: str, local_key: str, date_from: str, date_to: str, limit: int) -> List[dict]:
    resp = requests.get(
        f"{local_base}/logs",
        params={
            "date_from": date_from,
            "date_to": date_to,
            "limit": str(limit),
        },
        headers={"X-Api-Key": local_key},
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else []


def fetch_supabase_created_at_set(
    supabase_base: str, supabase_key: str, date_from: str, date_to: str, limit: int
) -> set[str]:
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
    }
    params: List[Tuple[str, str]] = [
        ("select", "created_at"),
        ("created_at", f"gte.{date_from}T00:00:00+00:00"),
        ("created_at", f"lte.{date_to}T23:59:59+00:00"),
        ("limit", str(limit)),
    ]
    resp = requests.get(
        f"{supabase_base}/rest/v1/security_logs",
        params=params,
        headers=headers,
        timeout=60,
    )
    resp.raise_for_status()
    data = resp.json()
    rows = data if isinstance(data, list) else []
    return {canonical_created_at(row.get("created_at", "")) for row in rows if row.get("created_at")}


def build_payload(row: dict) -> dict | None:
    created = to_utc_iso(row.get("created_at", ""))
    if not created:
        return None

    payload = {k: row.get(k, "") for k in SYNC_FIELDS}
    payload["created_at"] = created
    payload["exit_at"] = to_utc_iso(row.get("exit_at", "")) if row.get("exit_at") else None
    payload["event_type"] = payload.get("event_type") or "manual"
    payload["user_email"] = payload.get("user_email") or "guvenlik@malhotra.com"
    return payload


def chunked(items: List[dict], size: int) -> Iterable[List[dict]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def insert_many(supabase_base: str, supabase_key: str, rows: List[dict], chunk_size: int) -> int:
    if not rows:
        return 0
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    inserted = 0
    for batch in chunked(rows, chunk_size):
        resp = requests.post(
            f"{supabase_base}/rest/v1/security_logs",
            json=batch,
            headers=headers,
            timeout=60,
        )
        resp.raise_for_status()
        inserted += len(batch)
    return inserted


def update_many(supabase_base: str, supabase_key: str, rows: List[dict]) -> int:
    if not rows:
        return 0
    headers = {
        "apikey": supabase_key,
        "Authorization": f"Bearer {supabase_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    updated = 0
    for row in rows:
        created_at = row["created_at"]
        patch_data = {k: v for k, v in row.items() if k != "created_at"}
        resp = requests.patch(
            f"{supabase_base}/rest/v1/security_logs",
            params=[("created_at", f"eq.{created_at}")],
            json=patch_data,
            headers=headers,
            timeout=60,
        )
        resp.raise_for_status()
        updated += 1
    return updated


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync local security logs to Supabase")
    parser.add_argument("--date-from", default="2026-02-05")
    parser.add_argument("--date-to", default="2026-02-19")
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--chunk-size", type=int, default=200)
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    env_path = project_root / ".env"
    env = load_env(env_path)

    local_base = (env.get("REACT_APP_LOCAL_API_URL") or env.get("VITE_LOCAL_API_URL") or "").rstrip("/")
    local_key = env.get("REACT_APP_LOCAL_API_KEY") or env.get("VITE_LOCAL_API_KEY") or ""
    supabase_base = (env.get("REACT_APP_SUPABASE_URL") or env.get("VITE_SUPABASE_URL") or "").rstrip("/")
    supabase_key = env.get("REACT_APP_SUPABASE_ANON_KEY") or env.get("VITE_SUPABASE_ANON_KEY") or ""

    if not local_base or not local_key or not supabase_base or not supabase_key:
        raise RuntimeError("Missing LOCAL API / Supabase env values in .env")

    local_rows = fetch_local_logs(local_base, local_key, args.date_from, args.date_to, args.limit)
    supa_created = fetch_supabase_created_at_set(
        supabase_base, supabase_key, args.date_from, args.date_to, args.limit
    )

    to_insert: List[dict] = []
    to_update: List[dict] = []
    seen: set[str] = set()
    for row in local_rows:
        payload = build_payload(row)
        if not payload:
            continue
        key = canonical_created_at(payload["created_at"])
        if not key or key in seen:
            continue
        seen.add(key)
        if key in supa_created:
            to_update.append(payload)
        else:
            to_insert.append(payload)

    inserted = insert_many(supabase_base, supabase_key, to_insert, args.chunk_size)
    updated = update_many(supabase_base, supabase_key, to_update)

    print(f"date_range={args.date_from}..{args.date_to}")
    print(f"local_rows={len(local_rows)}")
    print(f"inserted={inserted}")
    print(f"updated={updated}")
    print(f"total_processed={inserted + updated}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

