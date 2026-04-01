import contextlib
import importlib.util
import io
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path


HEALTH_CHECK_PATH = Path(__file__).with_name("health_check.py")
SPEC = importlib.util.spec_from_file_location("health_check", HEALTH_CHECK_PATH)
health_check = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(health_check)


class HealthCheckSecurityLogIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.addCleanup(self.tempdir.cleanup)
        self.original_appdata = os.environ.get("APPDATA")
        os.environ["APPDATA"] = self.tempdir.name
        self.addCleanup(self._restore_appdata)
        self.db_path = Path(self.tempdir.name) / "newsecurityy" / "security_panel.db"
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def _restore_appdata(self):
        if self.original_appdata is None:
            os.environ.pop("APPDATA", None)
        else:
            os.environ["APPDATA"] = self.original_appdata

    def _write_logs(self, rows):
        con = sqlite3.connect(self.db_path)
        cur = con.cursor()
        cur.execute(
            """
            CREATE TABLE security_logs (
                created_at TEXT,
                exit_at TEXT
            )
            """
        )
        cur.executemany(
            "INSERT INTO security_logs (created_at, exit_at) VALUES (?, ?)",
            rows,
        )
        con.commit()
        con.close()

    def _run_check(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = health_check.check_local_db()
        return result, output.getvalue()

    def test_duplicate_created_at_fails_gate(self):
        self._write_logs([
            ("2026-04-01T10:00:00.000Z", None),
            ("2026-04-01T10:00:00.000Z", None),
        ])

        ok, output = self._run_check()

        self.assertFalse(ok)
        self.assertIn("[FAIL] created_at duplicates", output)

    def test_null_created_at_fails_gate(self):
        self._write_logs([
            (None, None),
        ])

        ok, output = self._run_check()

        self.assertFalse(ok)
        self.assertIn("[FAIL] created_at null values", output)


if __name__ == "__main__":
    unittest.main()
