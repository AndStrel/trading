import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import verify_strategy_service as verification


class ReadOnlyReadback(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="strategy-readback-")
        self.root = Path(self.temp.name).resolve()
        (self.root / "ops").mkdir()
        self.probe = "// private profile probe"
        (self.root / "ops/profile_probe.mjs").write_text(self.probe)
        self.original_env = b"SECRET=private-secret-marker\n"
        (self.root / ".env").write_bytes(self.original_env)
        self.sha, self.cid = "1" * 40, "c" * 64
        self.running_revision = self.sha
        self.image = "sha256:" + "2" * 64
        self.clock, self.calls, self.inspect_count, self.slow_profile = 0, [], 0, 0
        self.dirty, self.fail_runtime, self.stop_after_probe = False, False, False
        self.logs_present, self.http_ready, self.logs_failure = True, True, None
        self.candidate_failure = None
        self.snapshot = {"env": {"SECRET": "private-secret-marker", "ACCOUNT_ID": "private-account-marker"},
                         "config": {"execution": {"mode": "disabled", "token": "private-secret-marker"},
                                    "telegram": {"miniApp": {"enabled": True}}},
                         "state": {"execution.kill_switch": "true", "unresolved": 0,
                                   "execution.sandbox_account_id": "private-account-marker"}}
        self.selection = {"strategyId": "trend-momentum-v1", "revision": 3, "tickers": ["VTBR", "IRAO"],
                          "private": "private-secret-marker"}

    def tearDown(self):
        self.temp.cleanup()

    def completed(self, args, stdout="", code=0, stderr="private-secret-marker private-account-marker"):
        return subprocess.CompletedProcess(args, code, stdout, stderr)

    def fake_run(self, args, input=None, **kwargs):
        self.calls.append((args, input, kwargs))
        self.assertTrue(kwargs["capture_output"])
        self.assertTrue(kwargs["text"])
        self.assertEqual(kwargs["cwd"], self.root)
        if args[:3] == ["git", "rev-parse", "HEAD"]:
            return self.completed(args, self.sha)
        if args[0] == "git":
            return self.completed(args, " M private-secret-marker" if self.dirty else "")
        if args[:2] == ["docker", "compose"]:
            self.assertEqual(args[-3:], ["ps", "-aq", "telegram-service"])
            return self.completed(args, self.cid)
        if args[:2] == ["docker", "inspect"]:
            self.inspect_count += 1
            stopped = self.fail_runtime or self.stop_after_probe and self.inspect_count > 1
            if stopped:
                self.clock += 11
            return self.completed(args, json.dumps({"Image": self.image, "RestartCount": 2,
                "State": {"Status": "exited" if stopped else "running", "Running": not stopped,
                          "Restarting": False, "OOMKilled": stopped, "Error": "private-secret-marker"},
                "Config": {"Env": ["SECRET=private-secret-marker"],
                           "Labels": {"org.opencontainers.image.revision": self.running_revision}}}))
        if args[:2] == ["docker", "logs"]:
            if self.logs_failure:
                raise self.logs_failure
            events = [{"event": "daily-pilot-profile-loaded", "token": "private-secret-marker"},
                      {"event": "trading-selection-loaded", "accountId": "private-account-marker"}]
            return self.completed(args, "\n".join(json.dumps(event) for event in events) if self.logs_present else "")
        if args[:2] == ["docker", "exec"]:
            source = args[-1]
            if source == self.probe:
                self.clock += self.slow_profile
                return self.completed(args, json.dumps(self.snapshot))
            if source == verification.SELECTION_PROBE:
                self.assertIn("readOnly: true", source)
                self.assertNotIn("INSERT", source)
                return self.completed(args, json.dumps(self.selection))
            if source == verification.HTTP_PROBE:
                self.assertIn("http://127.0.0.1:", source)
                self.assertNotIn("POST", source)
                if not self.http_ready:
                    self.clock += 11
                return self.completed(args, json.dumps({key: self.http_ready for key in
                    ("htmlControls", "javascriptCurrent", "unauthenticatedViewBlocked")}))
        if args[:2] == ["docker", "run"]:
            self.assertEqual(args, ["docker", "run", "--rm", "--network", "none", "-i", "--log-driver", "none",
                "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--entrypoint", "node",
                self.image, "--input-type=module", "-e", self.probe, "--", "--candidate"])
            self.assertEqual(kwargs["timeout"], 19)
            self.assertEqual(json.loads(input), self.snapshot["env"])
            self.assertNotIn("private-secret-marker", " ".join(args))
            if isinstance(self.candidate_failure, Exception):
                raise self.candidate_failure
            if self.candidate_failure:
                return self.completed(args, "", 1, self.candidate_failure)
            return self.completed(args, json.dumps(self.snapshot))
        self.fail("Unexpected command")

    def verify(self, expected_sha=None, public_url=None):
        with patch.object(verification, "ROOT", self.root), patch.object(verification.subprocess, "run", self.fake_run), \
                patch.object(verification.time, "monotonic", lambda: self.clock), patch.object(verification.time, "sleep"):
            report = verification.verify(expected_sha or self.sha, public_url)
        output = json.dumps(report)
        for marker in ("private-secret-marker", "private-account-marker", self.cid, self.image):
            self.assertNotIn(marker, output)
        self.assertEqual((self.root / ".env").read_bytes(), self.original_env)
        self.assertFalse(any("up" in args or "restart" in args for args, _, _ in self.calls))
        return report

    def test_readonly_runtime_and_minimal_projection(self):
        report = self.verify()
        self.assertEqual(report["result"], "verified")
        self.assertEqual(report["buildRevision"], self.sha)
        self.assertEqual(report["runtime"], {"state": "running", "restartCount": 2, "oomKilled": False})
        self.assertEqual(report["tradingSelection"], {"strategyId": "trend-momentum-v1", "revision": 3, "tickers": ["VTBR", "IRAO"]})
        self.assertTrue(report["miniApp"]["ready"])
        self.assertTrue(report["candidateAppConfig"]["ready"])
        self.assertFalse(report["ordersSubmitted"])
        logs_index = next(index for index, (args, _, _) in enumerate(self.calls) if args[:2] == ["docker", "logs"])
        http_index = next(index for index, (args, _, _) in enumerate(self.calls) if args[-1] == verification.HTTP_PROBE)
        self.assertGreater(logs_index, http_index)

    def test_source_mismatch_or_dirty_tracked_files_never_runs_docker(self):
        for dirty in (False, True):
            with self.subTest(dirty=dirty):
                self.calls.clear()
                self.dirty = dirty
                report = self.verify(self.sha if dirty else "3" * 40)
                self.assertEqual(report["result"], "not-ready")
                self.assertFalse(any(args[0] == "docker" for args, _, _ in self.calls))

    def test_requires_running_container_and_rechecks_after_probes(self):
        self.fail_runtime = True
        self.assertEqual(self.verify()["reason"], "service-not-running")
        self.fail_runtime, self.stop_after_probe, self.clock, self.inspect_count = False, True, 0, 0
        self.assertEqual(self.verify()["reason"], "service-runtime-changed")

    def test_running_image_must_match_expected_revision_not_only_checkout(self):
        for revision in ("3" * 40, "private-secret-marker", None):
            with self.subTest(revision=revision):
                self.running_revision = revision
                report = self.verify()
                self.assertEqual(report["result"], "not-ready")
                self.assertEqual(report["reason"], "running-image-revision-mismatch")
                self.assertEqual(report["buildRevision"], revision if revision == "3" * 40 else None)

    def test_execution_mode_kill_and_unresolved_are_failclosed(self):
        original = copy.deepcopy(self.snapshot)
        for target, key, value in (("config", "mode", "sandbox"), ("state", "execution.kill_switch", "false"),
                                   ("state", "unresolved", 1), ("state", "unresolved", True)):
            with self.subTest(key=key):
                self.snapshot = copy.deepcopy(original)
                group = self.snapshot["config"]["execution"] if target == "config" else self.snapshot["state"]
                group[key] = value
                self.assertEqual(self.verify()["result"], "not-ready")

    def test_live_mode_requires_account_consistent_arming_state(self):
        original = copy.deepcopy(self.snapshot)

        def live(kill, armed, unresolved):
            snapshot = copy.deepcopy(original)
            snapshot["config"]["execution"]["mode"] = "live"
            snapshot["config"]["execution"]["accountId"] = "private-account-marker"
            snapshot["state"]["execution.kill_switch"] = kill
            snapshot["state"]["execution.live_armed_account"] = armed
            snapshot["state"]["unresolved"] = unresolved
            self.snapshot = snapshot
            return self.verify()["result"]

        self.assertEqual(live("true", None, 0), "verified")
        self.assertEqual(live("true", "private-account-marker", 2), "verified")
        self.assertEqual(live("false", "private-account-marker", 1), "verified")
        self.assertEqual(live("false", None, 0), "not-ready")
        self.assertEqual(live("false", "private-account-marker", 2), "not-ready")
        self.assertEqual(live("true", "private-account-marker", 4), "not-ready")
        snapshot = copy.deepcopy(original)
        snapshot["config"]["execution"]["mode"] = "live"
        snapshot["state"]["execution.live_armed_account"] = "private-account-marker"
        self.snapshot = snapshot
        self.assertEqual(self.verify()["result"], "not-ready")
        self.assertEqual(self.verify()["reason"], "live-safety-not-verified")

    def test_invalid_selection_is_not_projected(self):
        for key, value in (("strategyId", "private-secret-marker"), ("revision", True),
                           ("tickers", ["private-secret-marker"]), ("tickers", ["VTBR", "VTBR"])):
            with self.subTest(key=key):
                original = copy.deepcopy(self.selection)
                self.selection[key] = value
                report = self.verify()
                self.assertEqual(report["reason"], "trading-selection-invalid")
                self.assertIsNone(report["tradingSelection"])
                self.selection = original

    def test_local_http_requires_all_checks(self):
        self.http_ready = False
        self.assertEqual(self.verify()["reason"], "mini-app-not-ready")

    def test_old_startup_markers_are_informational_when_the_runtime_is_healthy(self):
        self.logs_present = False
        report = self.verify()
        self.assertEqual(report["result"], "verified")
        self.assertFalse(report["startupProfileSeen"])
        self.assertFalse(report["tradingSelectionSeen"])

    def test_informational_logs_timeout_or_exception_does_not_fail_healthy_runtime(self):
        for error in (subprocess.TimeoutExpired("private-secret-marker", 3, output="private-account-marker"),
                      OSError("private-secret-marker private-account-marker")):
            with self.subTest(error_type=type(error).__name__):
                self.logs_failure = error
                report = self.verify()
                self.assertEqual(report["result"], "verified")
                self.assertFalse(report["startupProfileSeen"])
                self.assertFalse(report["tradingSelectionSeen"])

    def test_slow_profile_read_does_not_consume_miniapp_readiness_allowance(self):
        self.slow_profile = 20
        report = self.verify()
        self.assertEqual(report["result"], "verified")
        self.assertTrue(report["miniApp"]["ready"])

    def test_candidate_failure_is_redacted_and_does_not_fail_healthy_runtime(self):
        for message, reason in (("ERR_MODULE_NOT_FOUND", "module-not-found"), ("No such image", "image-not-found"),
                                ("Permission denied", "permission"), ("cgroup allocation failed", "docker-runtime"),
                                ("other failure", "unknown")):
            with self.subTest(reason=reason):
                self.candidate_failure = message + " private-secret-marker private-account-marker"
                report = self.verify()
                self.assertEqual(report["result"], "verified")
                self.assertEqual(report["candidateAppConfig"], {"ready": False, "reason": reason})

    def test_candidate_timeout_discards_private_output(self):
        self.candidate_failure = subprocess.TimeoutExpired("private-secret-marker", 19, output="private-secret-marker")
        self.assertEqual(self.verify()["candidateAppConfig"], {"ready": False, "reason": "timed-out"})

    def test_invalid_config_category_is_fixed(self):
        result = self.completed([], '{"probeFailure":"config","secret":"private-secret-marker"}', 1)
        self.assertEqual(verification.candidate_reason(result), "invalid-config")

    def test_public_https_failure_is_separate_and_bounded(self):
        with patch.object(verification.urllib.request, "urlopen", side_effect=TimeoutError("private-secret-marker")) as get:
            report = self.verify(public_url="https://bot.example.test")
        self.assertEqual(report["result"], "verified")
        self.assertEqual(report["publicHttps"], {"checked": True, "reachable": False})
        get.assert_called_once_with("https://bot.example.test", timeout=5)
        with patch.object(verification.urllib.request, "urlopen") as get:
            self.assertFalse(verification.public_reachable("https://private-secret-marker@bot.example.test")["reachable"])
            get.assert_not_called()

    def test_main_uses_only_runtime_result_for_exit_status_and_suppresses_argument_values(self):
        for result, status in (("verified", 0), ("not-ready", 1)):
            with patch.object(verification, "verify", return_value={"result": result}), \
                    patch("sys.argv", ["verify", "--expected-sha", self.sha]), contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(verification.main(), status)
        output = io.StringIO()
        with patch("sys.argv", ["verify", "--unknown", "private-secret-marker"]), contextlib.redirect_stdout(output):
            self.assertEqual(verification.main(), 1)
        self.assertNotIn("private-secret-marker", output.getvalue())


if __name__ == "__main__":
    unittest.main()
