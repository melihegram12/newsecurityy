import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path


def default_db_path() -> str:
    appdata = os.environ.get("APPDATA")
    if appdata:
        return str(Path(appdata) / "newsecurityy" / "security_panel.db")
    return str(Path.home() / "AppData" / "Roaming" / "newsecurityy" / "security_panel.db")


COMPANY_PREDICATE = """
(sub_category = 'Şirket Aracı' OR (sub_category LIKE '%irket%' AND sub_category LIKE '%Arac%'))
"""


FIND_SQL = f"""
SELECT id, plate, name, sub_category, created_at, exit_at
FROM security_logs
WHERE {COMPANY_PREDICATE}
  AND exit_at IS NOT NULL
  AND datetime(created_at) > datetime(exit_at)
ORDER BY created_at ASC
"""


def load_rows(db_path: str):
    if not Path(db_path).exists():
        raise FileNotFoundError(f"Veritabani bulunamadi: {db_path}")
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    try:
        return [dict(row) for row in con.execute(FIND_SQL).fetchall()]
    finally:
        con.close()


def apply_local_fix(db_path: str) -> int:
    if not Path(db_path).exists():
        raise FileNotFoundError(f"Veritabani bulunamadi: {db_path}")
    con = sqlite3.connect(db_path)
    try:
        cur = con.cursor()
        cur.execute("BEGIN")
        cur.execute(
            f"""
            UPDATE security_logs
            SET created_at = exit_at,
                exit_at = created_at
            WHERE {COMPANY_PREDICATE}
              AND exit_at IS NOT NULL
              AND datetime(created_at) > datetime(exit_at)
            """
        )
        updated = cur.rowcount
        con.commit()
        return updated
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def emit_supabase_sql(rows):
    print("-- Supabase backfill taslagi")
    print("-- Dry-run sonucuna gore once kayitlari yedekleyin, sonra asagidaki SQL'i uygulayin.")
    if not rows:
        print("-- Duzeltilecek satir bulunamadi.")
        return

    ids = ", ".join(str(int(row["id"])) for row in rows if str(row.get("id", "")).isdigit())
    if ids:
        print(
            "UPDATE public.security_logs\n"
            "SET created_at = exit_at,\n"
            "    exit_at = created_at\n"
            "WHERE id IN (" + ids + ");"
        )
        return

    print(
        "UPDATE public.security_logs\n"
        "SET created_at = exit_at,\n"
        "    exit_at = created_at\n"
        "WHERE (sub_category = 'Şirket Aracı' OR (sub_category LIKE '%irket%' AND sub_category LIKE '%Arac%'))\n"
        "  AND exit_at IS NOT NULL\n"
        "  AND created_at > exit_at;"
    )


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Sirket araci ters kronoloji kayitlarini tespit eder ve istege bagli duzeltir.")
    parser.add_argument("--db", default=default_db_path(), help="SQLite veritabani yolu")
    parser.add_argument("--apply-local", action="store_true", help="Local SQLite icinde created_at ve exit_at alanlarini swap eder")
    parser.add_argument("--emit-supabase-sql", action="store_true", help="Supabase icin ornek SQL cikisi uretir")
    parser.add_argument("--sample", type=int, default=10, help="Dry-run ciktisinda gosterilecek ornek satir sayisi")
    args = parser.parse_args()

    rows = load_rows(args.db)
    payload = {
        "db_path": args.db,
        "anomaly_count": len(rows),
        "sample": rows[: max(0, args.sample)],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    if args.emit_supabase_sql:
        emit_supabase_sql(rows)

    if args.apply_local:
        updated = apply_local_fix(args.db)
        print(json.dumps({"updated": updated}, ensure_ascii=False))


if __name__ == "__main__":
    main()
