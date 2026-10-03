import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

import verify_live_pilot as verification


class LiveReadOnlyReadback(unittest.TestCase):
    def setUp(self):
        self.sha, self.cid = "1" * 40, "c" * 64
        self.calls, self.inspect_count = [], 0
        self.dirty = False
        self.exec_error = None
        self.exec_code = 0
        self.exec_stdout = None
        self.after_changes = {}
        self.state = {"id": self.cid, "image": "sha256:" + "2" * 64,
                      "running": True, "restarting": False, "oomKilled": False, "status": "running",
                      "restartCount": 0, "revision": self.sha, "project": verification.PROJECT,
                      "service": verification.SERVICE, "directory": str(verification.ROOT)}
        self.payload = {"executionMode": "disabled", "pilotPreparing": True, "capitalRub": 500,
                        "maxTradeRiskRub": 20, "maxPositionRub": 498.25,
                        "maxDailyRiskRub": 60, "maxDailyLossRub": 60, "commissionRate": 0.003,
                        "liveTokenPresent": True, "liveAccountConfigured": True,
                        "accountChecksPassed": True, "liveSubmissionAllowed": False,
                        "blockers": [verification.LIVE_BLOCKER], "private": "private-secret-marker"}

    def completed(self, args, stdout="", code=0):
        return subprocess.CompletedProcess(args, code, stdout, "private-secret-marker private-account-marker")

    def fake_run(self, args, **kwargs):
        self.calls.append((args, kwargs))
        self.assertEqual(kwargs["stdin"], subprocess.DEVNULL)
        self.assertTrue(kwargs["capture_output"])
        self.assertTrue(kwargs["text"])
        self.assertFalse(kwargs["check"])
        self.assertEqual(kwargs["cwd"], verification.ROOT)
        self.assertGreater(kwargs["timeout"], 0)
        self.assertLessEqual(kwargs["timeout"], 30)
        if args == ["git", "rev-parse", "HEAD"]:
            return self.completed(args, self.sha)
        if args == ["git", "status", "--porcelain", "--untracked-files=no"]:
            return self.completed(args, " M private-secret-marker" if self.dirty else "")
        if args[:2] == ["docker", "ps"]:
            self.assertEqual(args, ["docker", "ps", "--all", "--filter", "label=com.docker.compose.project=andstrel-trading",
                                   "--filter", "label=com.docker.compose.service=telegram-service", "--format", "{{.ID}}"])
            return self.completed(args, self.cid)
        if args[:2] == ["docker", "inspect"]:
            self.assertEqual(args, ["docker", "inspect", "--format", verification.INSPECT, self.cid])
            self.assertNotIn(".Env", args[3])
            self.inspect_count += 1
            state = copy.deepcopy(self.state)
            if self.inspect_count > 1:
                state.update(self.after_changes)
            return self.completed(args, json.dumps(state))
        if args[:2] == ["docker", "exec"]:
            self.assertEqual(args, ["docker", "exec", self.cid, "node", "dist/pilot-preflight.js"])
            self.assertEqual(self.inspect_count, 1)
            if self.exec_error:
                raise self.exec_error
            return self.completed(args, self.exec_stdout if self.exec_stdout is not None else json.dumps(self.payload), self.exec_code)
        self.fail("Unexpected command")

    def verify(self, expected_sha=None):
        self.inspect_count = 0
        with patch.object(verification.subprocess, "run", self.fake_run):
            report = verification.verify(expected_sha or self.sha)
        serialized = json.dumps(report)
        for marker in ("private-secret-marker", "private-account-marker", self.cid, self.state["image"]):
            self.assertNotIn(marker, serialized)
        self.assertFalse(report["liveSubmissionAllowed"])
        self.assertFalse(report["brokerWrites"])
        self.assertTrue(all(args[0] == "git" or args[:2] in (["docker", "ps"], ["docker", "inspect"], ["docker", "exec"])
                            for args, _ in self.calls))
        return report

    def test_account_prepared_is_not_live_ready_and_only_existing_service_is_used(self):
        report = self.verify()
        self.assertEqual(report["result"], "account-checks-passed")
        self.assertTrue(report["accountChecksPassed"])
        self.assertEqual(report["executionMode"], "disabled")
        self.assertEqual(report["blockers"], verification.PROOF_GAPS)
        self.assertEqual(report["limits"]["capitalRub"], 500)
        self.assertNotIn("availableCashRub", report)
        self.assertEqual(self.inspect_count, 2)

    def test_sha_mismatch_or_dirty_checkout_prevents_docker_and_broker_reads(self):
        for dirty in (False, True):
            with self.subTest(dirty=dirty):
                self.calls.clear()
                self.dirty = dirty
                report = self.verify(self.sha if dirty else "3" * 40)
                self.assertEqual(report["reason"], "tracked-source-dirty" if dirty else "server-sha-mismatch")
                self.assertFalse(report["preflightInvoked"])
                self.assertFalse(any(args[0] == "docker" for args, _ in self.calls))

    def test_invalid_expected_sha_never_runs_any_command(self):
        report = self.verify("private-secret-marker")
        self.assertEqual(report["reason"], "invalid-expected-sha")
        self.assertEqual(self.calls, [])

    def test_wrong_revision_or_non_running_container_prevents_pilot(self):
        for change, reason in (({"revision": None}, "running-image-revision-mismatch"),
                               ({"revision": "3" * 40}, "running-image-revision-mismatch"),
                               ({"running": False, "status": "exited"}, "service-not-running"),
                               ({"restarting": True}, "service-not-running"),
                               ({"oomKilled": True}, "service-not-running"),
                               ({"directory": "/private-secret-marker"}, "runtime-target-mismatch")):
            with self.subTest(change=change):
                self.calls.clear()
                original = self.state.copy()
                self.state.update(change)
                report = self.verify()
                self.assertEqual(report["reason"], reason)
                self.assertFalse(report["preflightInvoked"])
                self.state = original

    def test_multiple_service_containers_are_not_guessed(self):
        self.cid = "c" * 64 + "\n" + "d" * 64
        self.assertEqual(self.verify()["reason"], "service-container-unavailable")

    def test_exit_zero_but_account_checks_false_remains_failure(self):
        self.payload["accountChecksPassed"] = False
        self.payload["blockers"].insert(0, "Счёт ещё не пополнен до суммы дневного пилота.")
        report = self.verify()
        self.assertEqual(report["result"], "not-ready")
        self.assertEqual(report["reason"], "account-checks-failed")
        self.assertIn("pilot-cash-insufficient", report["blockers"])

    def test_unknown_blocker_is_fixed_code_not_raw_broker_text(self):
        self.payload["accountChecksPassed"] = False
        self.payload["blockers"].insert(0, "private-secret-marker private-account-marker")
        self.assertIn("preflight-blocker-unclassified", self.verify()["blockers"])

    def test_unsafe_mode_or_live_flag_never_becomes_ready(self):
        for key, value, reason in (("executionMode", "sandbox", "execution-not-disabled"),
                                   ("liveSubmissionAllowed", True, "live-submission-not-forbidden")):
            with self.subTest(key=key):
                original = self.payload[key]
                self.payload[key] = value
                report = self.verify()
                self.assertEqual(report["result"], "not-ready")
                self.assertEqual(report["reason"], reason)
                self.payload[key] = original

    def test_malformed_payloads_and_bool_as_money_fail_closed(self):
        for payload in ("private-secret-marker", [], {"accountChecksPassed": True},
                        {**self.payload, "capitalRub": True}, {**self.payload, "commissionRate": 0.0003},
                        {**self.payload, "maxDailyLossRub": 61}, {**self.payload, "maxPositionRub": 501},
                        {**self.payload, "blockers": []}, {**self.payload, "liveTokenPresent": False}):
            with self.subTest(payload=type(payload).__name__):
                self.exec_stdout = json.dumps(payload)
                report = self.verify()
                self.assertEqual(report["result"], "not-ready")
                self.assertFalse(report["accountChecksPassed"])

    def test_raw_failed_process_output_and_exception_are_never_exposed(self):
        self.exec_code, self.exec_stdout = 1, "private-secret-marker private-account-marker"
        self.assertEqual(self.verify()["reason"], "pilot-preflight-failed")
        self.exec_error = RuntimeError("private-secret-marker private-account-marker")
        self.assertEqual(self.verify()["reason"], "readback-invalid")

    def test_bounded_timeout_is_not_account_readiness(self):
        self.exec_error = subprocess.TimeoutExpired("private-secret-marker", 30, output="private-account-marker")
        report = self.verify()
        self.assertEqual(report["reason"], "readback-timed-out")
        self.assertFalse(report["accountChecksPassed"])

    def test_total_deadline_stops_before_any_command(self):
        with patch.object(verification.subprocess, "run", self.fake_run), \
                patch.object(verification.time, "monotonic", side_effect=[0, 46]):
            report = verification.verify(self.sha)
        self.assertEqual(report["reason"], "readback-timed-out")
        self.assertEqual(self.calls, [])

    def test_runtime_change_after_account_read_prevents_success(self):
        for changes in ({"image": "sha256:" + "3" * 64}, {"restartCount": 1}, {"status": "exited", "running": False}):
            with self.subTest(changes=changes):
                self.after_changes = changes
                self.assertEqual(self.verify()["result"], "not-ready")

    def test_main_exit_status_follows_json_boolean_not_process_exit(self):
        for passed in (False, True):
            with self.subTest(passed=passed):
                output = io.StringIO()
                self.inspect_count = 0
                self.payload["accountChecksPassed"] = passed
                with patch.object(verification.subprocess, "run", self.fake_run), contextlib.redirect_stdout(output):
                    result = verification.main(["--expected-sha", self.sha])
                self.assertEqual(result, 0 if passed else 1)
                self.assertEqual(json.loads(output.getvalue())["accountChecksPassed"], passed)
                self.assertNotIn("private-secret-marker", output.getvalue())

    def test_invalid_cli_never_echoes_argument_or_exception(self):
        output, errors = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
            self.assertEqual(verification.main(["--private-secret-marker"]), 1)
        self.assertEqual(json.loads(output.getvalue())["reason"], "invalid-arguments")
        self.assertNotIn("private-secret-marker", output.getvalue() + errors.getvalue())

    def test_workflow_only_dispatches_pinned_main_readback(self):
        source = (Path(__file__).resolve().parents[1] / ".github/workflows/verify-live-pilot.yml").read_text()
        for text in ("workflow_dispatch:", "github.ref == 'refs/heads/main'", "EXPECTED_SHA: ${{ github.sha }}",
                     'test "$DEPLOY_PATH" = "/opt/andstrel/trading"', "StrictHostKeyChecking=yes",
                     "verify_live_pilot.py --expected-sha $EXPECTED_SHA", "contents: read"):
            self.assertIn(text, source)
        for text in ("compose up", "docker run", "--apply", "pilot-preflight.js", "workflow_run:"):
            self.assertNotIn(text, source)


if __name__ == "__main__":
    unittest.main()
