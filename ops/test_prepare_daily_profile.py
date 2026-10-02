import copy
import contextlib
import io
import json
import os
from pathlib import Path
import tempfile
import subprocess
import sqlite3
import unittest
from unittest.mock import patch
import prepare_daily_profile as migration
from prepare_daily_profile import FIXED, Refused, patch_env, validate


def fixture():
    return {"env": {"T_INVEST_TRADING_TOKEN": "synthetic-trading", **FIXED},
            "config": {"token": "synthetic-read",
                       "execution": {"mode": "disabled", "sandboxInitialBalanceRub": 1000,
                                     "sandboxProtectionEnabled": False,
                                     "sandboxLossGuardEnabled": False,
                                     "sandboxSessionCloseEnabled": False},
                       "livePilot": {"prepare": True, "token": "synthetic-trading",
                                     "accountId": "synthetic-day", "capitalRub": 500,
                                     "maxTradeRiskRub": 20, "maxDailyRiskRub": 60,
                                     "maxDailyLossRub": 60},
                       "strategies": {"intraday": {"accountId": "synthetic-day", "allowShort": False},
                                      "swing": {"accountId": "synthetic-week"}}},
            "state": {"execution.kill_switch": "true", "execution.kill_generation": "synthetic",
                      "execution.sandbox_bootstrap_v1": "synthetic-private-ack",
                      "execution.sandbox_account_id": "synthetic-sandbox", "unresolved": 0}}


class Safeguards(unittest.TestCase):
    def test_only_fixed_keys_change(self):
        unchanged = b'# private comments\nT_INVEST_TOKEN="synthetic read"\nOTHER=value\n'
        original = unchanged + b'T_INVEST_LIVE_CAPITAL_RUB=1000\n'
        patched = patch_env(original)
        self.assertTrue(patched.startswith(unchanged))
        self.assertIn(b"T_INVEST_LIVE_CAPITAL_RUB=500\n", patched)
        self.assertEqual(patch_env(patched), patched)

    def test_duplicate_and_nul_refused(self):
        for raw in (b'T_INVEST_TRADING_TOKEN_ROLE=sandbox\nexport T_INVEST_TRADING_TOKEN_ROLE=live\n',
                    b'T_INVEST_TOKEN=synthetic\x00\n'):
            with self.assertRaises(Refused):
                patch_env(raw)

    def test_valid_migration(self):
        validate(fixture(), migrated=True)

    def test_fail_closed(self):
        alterations = [
            ("state", "execution.kill_switch", "false"),
            ("state", "unresolved", 1),
            ("state", "execution.kill_generation", None),
            ("env", "T_INVEST_TRADING_TOKEN_ROLE", "sandbox"),
        ]
        for group, key, value in alterations:
            sample = fixture()
            sample[group][key] = value
            with self.subTest(group=group, key=key), self.assertRaises(Refused):
                validate(sample, migrated=True)

    def test_execution_flags_accounts_and_risk(self):
        cases = [
            ("execution", "mode", "sandbox"),
            ("execution", "sandboxProtectionEnabled", True),
            ("execution", "sandboxLossGuardEnabled", True),
            ("execution", "sandboxSessionCloseEnabled", True),
            ("livePilot", "prepare", False),
            ("livePilot", "capitalRub", 1000),
            ("livePilot", "maxTradeRiskRub", 21),
            ("livePilot", "maxDailyRiskRub", 61),
            ("livePilot", "maxDailyLossRub", 61),
            ("livePilot", "accountId", "synthetic-week"),
            ("livePilot", "token", "synthetic-other"),
        ]
        for group, key, value in cases:
            sample = fixture()
            sample["config"][group][key] = value
            with self.subTest(group=group, key=key), self.assertRaises(Refused):
                validate(sample, migrated=True)
        sample = fixture()
        sample["config"]["strategies"]["swing"]["accountId"] = "synthetic-day"
        with self.assertRaises(Refused):
            validate(sample)


class Flow(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="profile-flow-")
        self.root = Path(self.temp.name).resolve() / "trading"
        self.root.mkdir()
        (self.root / "ops").mkdir()
        (self.root / "ops/profile_probe.mjs").write_text("// synthetic")
        (self.root / "docker-compose.yml").write_text("services:\n  telegram-service:\n    env_file:\n      - .env\n")
        self.original = (b"T_INVEST_TOKEN=synthetic-read\n"
                         b"T_INVEST_TRADING_TOKEN=synthetic-trading\n"
                         b"T_INVEST_LIVE_CAPITAL_RUB=1000\n")
        migration.private_file(self.root / ".env", self.original)
        self.runtime_env = self.parse(self.original)
        self.restarts = 0
        self.fail_restart = False
        self.fail_candidate = False
        self.sha = "1" * 40
        self.image = "sha256:" + "2" * 64

    def tearDown(self):
        self.temp.cleanup()

    def parse(self, content):
        return dict(line.split("=", 1) for line in content.decode().splitlines())

    def snap(self, env):
        result = fixture()
        result["env"] = dict(env)
        result["config"]["livePilot"]["capitalRub"] = int(env.get("T_INVEST_LIVE_CAPITAL_RUB", "1000"))
        if env.get("T_INVEST_TRADING_TOKEN_ROLE") != "live":
            del result["config"]["livePilot"]["token"]
        return result

    def fake(self, args, data=None):
        if args[:3] == ["git", "rev-parse", "HEAD"]:
            return self.sha
        if args[0] == "git":
            return ""
        if args[:2] == ["docker", "inspect"]:
            return self.image
        if args[:2] == ["docker", "exec"]:
            return json.dumps(self.snap(self.runtime_env))
        if args[:2] == ["docker", "run"]:
            self.assertIn("--network", args)
            self.assertEqual(args[args.index("--network") + 1], "none")
            self.assertIn("-i", args)
            self.assertEqual(args[args.index("--log-driver") + 1], "none")
            self.assertEqual(args[-2:], ["--", "--candidate"])
            if self.fail_candidate:
                raise Refused()
            return json.dumps(self.snap(json.loads(data)))
        self.assertEqual(args[:2], ["docker", "compose"])
        if "ps" in args:
            return "synthetic-container"
        if "config" in args:
            path = Path(args[args.index("--env-file") + 1])
            return json.dumps({"services": {"telegram-service": {"environment": self.parse(path.read_bytes())}}})
        if "up" in args:
            self.restarts += 1
            self.assertIn("--no-build", args)
            self.assertIn("--force-recreate", args)
            self.assertEqual(args[args.index("--pull") + 1], "never")
            if self.fail_restart and self.restarts == 1:
                raise Refused()
            self.runtime_env = self.parse((self.root / ".env").read_bytes())
            self.runtime_env["HOSTNAME"] = "synthetic-new-container"
            return ""
        self.fail("unexpected command")

    def run_migration(self, apply):
        out = io.StringIO()
        with patch.object(migration, "ROOT", self.root), patch.object(migration, "command", self.fake):
            with contextlib.redirect_stdout(out):
                migration.migrate(self.sha, apply)
        return out.getvalue()

    def test_dry_run_no_file_change_no_restart(self):
        out = self.run_migration(False)
        self.assertIn("dry-run-ok", out)
        self.assertEqual((self.root / ".env").read_bytes(), self.original)
        self.assertEqual(self.restarts, 0)
        self.assertFalse(list(self.root.parent.glob("trading-profile-backup-*")))
        self.assertNotIn("synthetic", out)

    def test_apply_preserves_tokens_backup_and_execution(self):
        out = self.run_migration(True)
        self.assertIn('"result":"applied"', out)
        self.assertNotIn("synthetic", out)
        self.assertEqual(self.restarts, 1)
        applied = (self.root / ".env").read_bytes()
        self.assertEqual(applied, patch_env(self.original))
        backup = list(self.root.parent.glob("trading-profile-backup-*/env.before"))
        self.assertEqual(len(backup), 1)
        self.assertEqual(backup[0].read_bytes(), self.original)
        self.assertEqual(backup[0].stat().st_mode & 0o777, 0o600)

    def test_candidate_failure_does_not_write(self):
        self.fail_candidate = True
        with self.assertRaises(Refused):
            self.run_migration(True)
        self.assertEqual((self.root / ".env").read_bytes(), self.original)
        self.assertEqual(self.restarts, 0)

    def test_restart_failure_restores_original(self):
        self.fail_restart = True
        with self.assertRaises(Refused):
            self.run_migration(True)
        self.assertEqual((self.root / ".env").read_bytes(), self.original)
        self.assertEqual(self.restarts, 2)

    def test_concurrent_operator_change_not_overwritten(self):
        original_fake = self.fake
        def concurrent(args, data=None):
            if "up" in args:
                (self.root / ".env").write_bytes(b"OPERATOR=synthetic\n")
                raise Refused()
            return original_fake(args, data)
        out = io.StringIO()
        with patch.object(migration, "ROOT", self.root), patch.object(migration, "command", concurrent):
            with contextlib.redirect_stdout(out), self.assertRaises(Refused):
                migration.migrate(self.sha, True)
        self.assertEqual((self.root / ".env").read_bytes(), b"OPERATOR=synthetic\n")
        self.assertIn("concurrent-change", out.getvalue())

class RealProbe(unittest.TestCase):
    def setUp(self):
        self.repo = Path(__file__).resolve().parents[1]
        self.source = (self.repo / "ops/profile_probe.mjs").read_text().replace(
            "/app/dist/", str(self.repo / "dist") + "/")
        self.env = {
            "T_INVEST_TOKEN": "synthetic-read",
            "T_INVEST_TRADING_TOKEN": "synthetic-trading",
            **FIXED,
            "T_INVEST_INTRADAY_ACCOUNT_ID": "synthetic-day",
            "T_INVEST_SWING_ACCOUNT_ID": "synthetic-week",
            "T_INVEST_LIVE_ACCOUNT_ID": "synthetic-day",
        }

    def invoke(self, candidate=True):
        return subprocess.run(["node", "--input-type=module", "-e", self.source]
                              + (["--", "--candidate"] if candidate else []),
                              input=json.dumps(self.env) if candidate else None,
                              capture_output=True, text=True,
                              env={"PATH": os.environ["PATH"], **self.env})

    def test_real_config_candidate_and_routing(self):
        result = self.invoke()
        self.assertEqual(result.returncode, 0)
        value = json.loads(result.stdout)
        validate(value, migrated=True)
        self.assertNotIn("token", value["config"]["execution"])
        self.assertEqual(value["config"]["livePilot"]["token"], "synthetic-trading")

    def test_real_config_conflicting_alias_refused(self):
        self.env["T_INVEST_LIVE_TOKEN"] = "synthetic-other"
        self.assertNotEqual(self.invoke().returncode, 0)

    def test_real_journal_read_only_and_ack_binding(self):
        with tempfile.TemporaryDirectory(prefix="profile-probe-") as folder:
            path = Path(folder) / "journal.sqlite"
            self.env["T_INVEST_JOURNAL_PATH"] = str(path)
            nonce = "11111111-1111-4111-8111-111111111111"
            ack = json.dumps({"version": 1,
                "endpoint": "https://sandbox-invest-public-api.tbank.ru/rest",
                "phase": "ready", "nonce": nonce, "name": "daily-pilot-" + nonce,
                "accountId": "synthetic-sandbox"})
            with sqlite3.connect(path) as db:
                db.execute("CREATE TABLE runtime_state (key TEXT PRIMARY KEY, value TEXT)")
                db.execute("CREATE TABLE execution_orders (status TEXT)")
                db.executemany("INSERT INTO runtime_state VALUES (?,?)", [
                    ("execution.kill_switch", "true"),
                    ("execution.kill_generation", "synthetic-generation"),
                    ("execution.sandbox_bootstrap_v1", ack),
                    ("execution.sandbox_account_id", "synthetic-sandbox")])
            before = path.read_bytes()
            result = self.invoke(False)
            self.assertEqual(result.returncode, 0)
            validate(json.loads(result.stdout), migrated=True)
            self.assertEqual(path.read_bytes(), before)
            with sqlite3.connect(path) as db:
                db.execute("UPDATE runtime_state SET value='synthetic-other' "
                           "WHERE key='execution.sandbox_account_id'")
            self.assertNotEqual(self.invoke(False).returncode, 0)


if __name__ == "__main__":
    unittest.main()
