# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: Copyright the Vortex contributors

"""Exercise the real CLI against disposable PostgreSQL 16 (Docker required)."""

from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import uuid

import psycopg
from psycopg.conninfo import make_conninfo

ROOT = Path(__file__).resolve().parents[2]
RUNNER = ROOT / "scripts/migrate-schema.py"


class MigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.container = subprocess.check_output(
            ["docker", "run", "--rm", "-d", "-e", "POSTGRES_PASSWORD=test",
             "-p", "127.0.0.1::5432", "postgres:16-alpine"], text=True
        ).strip()
        cls.addClassCleanup(subprocess.run, ["docker", "rm", "-f", cls.container],
                            check=True, stdout=subprocess.DEVNULL)
        port = subprocess.check_output(
            ["docker", "port", cls.container, "5432"], text=True
        ).strip().rsplit(":", 1)[1]
        cls.dsn = make_conninfo(host="127.0.0.1", port=port, user="postgres",
                               password="test", dbname="postgres", sslmode="disable",
                               connect_timeout=2)
        for _ in range(60):
            try:
                with psycopg.connect(cls.dsn):
                    return
            except psycopg.OperationalError:
                time.sleep(0.5)
        raise RuntimeError("Postgres did not start")

    def setUp(self):
        database = "test_" + uuid.uuid4().hex
        with psycopg.connect(self.dsn, autocommit=True) as conn:
            conn.execute(f'CREATE DATABASE "{database}"')
        self.target = make_conninfo(self.dsn, dbname=database)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.migrations = Path(self.directory.name)

    def run_cli(self, command, expected, *, target=None, migrations=None):
        result = subprocess.run(
            [sys.executable, str(RUNNER), command, "--target", target or self.target,
             "--migrations", str(migrations or self.migrations)],
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, expected, result.stdout + result.stderr)
        return result

    def test_status_distinguishes_drift_and_failure(self):
        self.run_cli("status", 0)
        (self.migrations / "001_first.sql").write_text("CREATE TABLE first (id int);")
        self.run_cli("status", 1)
        self.run_cli("apply", 0)
        self.run_cli("status", 0)
        (self.migrations / "001_first.sql").unlink()
        self.run_cli("status", 1)
        self.run_cli("status", 2, migrations=self.migrations / "missing")
        self.run_cli("status", 2, target=make_conninfo(self.target, port=1))
        self.run_cli("invalid-command", 2)
        with psycopg.connect(self.target, autocommit=True) as conn:
            conn.execute("CREATE ROLE denied_status LOGIN PASSWORD 'test'")
        self.run_cli("status", 2, target=make_conninfo(self.target, user="denied_status"))

    def test_failed_migration_rolls_back_only_its_ddl_and_ledger(self):
        (self.migrations / "001_first.sql").write_text("CREATE TABLE first (id int);")
        second = self.migrations / "002_second.sql"
        second.write_text("CREATE TABLE second (id int); SELECT missing_column;")
        self.run_cli("apply", 2)
        with psycopg.connect(self.target) as conn:
            self.assertEqual(conn.execute("SELECT filename FROM public._applied_migrations").fetchall(),
                             [("001_first.sql",)])
            self.assertIsNone(conn.execute("SELECT to_regclass('second')").fetchone()[0])
            self.assertIsNotNone(conn.execute("SELECT to_regclass('first')").fetchone()[0])
        second.write_text("CREATE TABLE second (id int);")
        self.run_cli("apply", 0)
        self.assertIn("0 migration(s) applied", self.run_cli("apply", 0).stderr)
        self.run_cli("status", 0)

    def test_real_bootstrap_and_steady_state_permissions(self):
        migrations = sorted((ROOT / "migrations").glob("*.sql"))
        bootstrap_end = max(i for i, path in enumerate(migrations)
                            if "-- migrate-schema: requires-superuser" in path.read_text())
        for migration in migrations[:bootstrap_end + 1]:
            shutil.copy(migration, self.migrations)
        # CREATEROLE models the non-superuser bootstrap path. The local rds_iam
        # role exercises guarded grants only, not RDS IAM authentication.
        with psycopg.connect(self.target, autocommit=True) as conn:
            conn.execute("CREATE ROLE rds_iam")
            conn.execute("CREATE ROLE bootstrap LOGIN CREATEROLE PASSWORD 'test'")
            conn.execute("GRANT rds_iam TO bootstrap WITH ADMIN TRUE")
            conn.execute("GRANT ALL ON SCHEMA public TO bootstrap WITH GRANT OPTION")
        bootstrap = make_conninfo(self.target, user="bootstrap")
        self.run_cli("apply", 0, target=bootstrap)
        self.run_cli("status", 0, target=bootstrap)
        with psycopg.connect(self.target, autocommit=True) as conn:
            for role in ("migrator", "bench_ingest", "bench_read"):
                conn.execute(f"ALTER ROLE {role} PASSWORD 'test'")
        migrator = make_conninfo(self.target, user="migrator")
        for migration in migrations[bootstrap_end + 1:]:
            shutil.copy(migration, self.migrations)
        self.run_cli("apply", 0, target=migrator)
        self.run_cli("status", 0, target=migrator)
        self.assertIn("0 migration(s) applied", self.run_cli("apply", 0, target=migrator).stderr)
        (self.migrations / "999_future.sql").write_text("CREATE TABLE future (id int);")
        self.run_cli("apply", 0, target=migrator)
        for role, allowed in (("bench_read", "SELECT"), ("bench_ingest", "SELECT,INSERT,UPDATE")):
            with psycopg.connect(make_conninfo(self.target, user=role)) as conn:
                for privilege in allowed.split(","):
                    self.assertTrue(conn.execute("SELECT has_table_privilege('future', %s)", (privilege,)).fetchone()[0])
                self.assertFalse(conn.execute("SELECT has_table_privilege('future', 'DELETE')").fetchone()[0])
                self.assertFalse(conn.execute("SELECT has_schema_privilege('public', 'CREATE')").fetchone()[0])
                self.assertFalse(conn.execute("SELECT has_table_privilege('_applied_migrations', 'SELECT')").fetchone()[0])
                if role == "bench_read":
                    self.assertFalse(conn.execute("SELECT has_table_privilege('commits', 'INSERT')").fetchone()[0])
                else:
                    conn.execute("INSERT INTO future VALUES (1)")
                    conn.execute("UPDATE future SET id = 2")
        (self.migrations / "999_marked.sql").write_text(
            "-- migrate-schema: requires-superuser\nCREATE TABLE forbidden (id int);"
        )
        result = self.run_cli("apply", 2, target=migrator)
        self.assertIn("master-capable", result.stderr)
        with psycopg.connect(self.target) as conn:
            self.assertIsNone(conn.execute("SELECT to_regclass('forbidden')").fetchone()[0])
