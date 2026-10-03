"""Read-only deployment read-back; private subprocess output never reaches logs."""
import argparse
import json
from pathlib import Path
import re
import subprocess
import time
import urllib.request
from urllib.parse import urlsplit

ROOT = Path("/opt/andstrel/trading")
SERVICE = "telegram-service"
STRATEGIES = {"trend-momentum-v1", "opening-range-breakout-v1", "vwap-reclaim-v1"}
SELECTION_PROBE = """
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '/app/dist/config.js';
const db = new DatabaseSync(loadConfig().journalPath, { readOnly: true });
try {
  process.stdout.write(db.prepare('SELECT value FROM runtime_state WHERE key=?')
    .get('trading.selection.v1')?.value ?? 'null');
} finally { db.close(); }
"""
HTTP_PROBE = """
const base = 'http://127.0.0.1:' + (process.env.TELEGRAM_MINI_APP_PORT || '8080');
try {
  const responses = await Promise.all(['/', '/app.js', '/api/view'].map(path =>
    fetch(base + path, { redirect: 'error', signal: AbortSignal.timeout(1500) })));
  const html = await responses[0].text(), script = await responses[1].text();
  const htmlControls = responses[0].status === 200
    && html.includes('id="strategy-select"') && html.includes('id="asset-options"');
  const javascriptCurrent = responses[1].status === 200
    && script.includes('strategy-select') && script.includes('assets-select') && script.includes('expectedRevision');
  const unauthenticatedViewBlocked = responses[2].status === 401;
  process.stdout.write(JSON.stringify({ htmlControls, javascriptCurrent, unauthenticatedViewBlocked }));
} catch { process.stdout.write('{}'); }
"""


class Refused(Exception):
    def __init__(self, code):
        self.code = code


def require(value, code):
    if not value:
        raise Refused(code)


def run(args, data=None, timeout=10):
    return subprocess.run(args, input=data, capture_output=True, text=True,
                          cwd=ROOT, timeout=timeout)


def private_output(args, timeout=10):
    result = run(args, timeout=timeout)
    require(result.returncode == 0, "readback-command-failed")
    return result.stdout.strip()


def candidate_reason(result):
    try:
        if json.loads(result.stdout).get("probeFailure") == "config":
            return "invalid-config"
    except (ValueError, AttributeError):
        pass
    private = (result.stdout + result.stderr).lower()
    for reason, markers in (
        ("module-not-found", ("err_module_not_found", "cannot find module", "cannot find package")),
        ("image-not-found", ("no such image", "unable to find image", "pull access denied")),
        ("permission", ("permission denied", "operation not permitted", "read-only file system")),
        ("docker-runtime", ("docker", "cgroup", "out of memory", "cannot allocate memory", "heap out of memory")),
    ):
        if any(marker in private for marker in markers):
            return reason
    return "unknown"


def candidate_diagnostic(image, probe, env):
    args = ["docker", "run", "--rm", "--network", "none", "-i", "--log-driver", "none",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--entrypoint", "node", image, "--input-type=module", "-e", probe, "--", "--candidate"]
    try:
        result = run(args, json.dumps(env), timeout=19)
        if result.returncode != 0:
            return {"ready": False, "reason": candidate_reason(result)}
        value = json.loads(result.stdout)
        valid = isinstance(value, dict) and isinstance(value.get("config"), dict) and value.get("env") == env
        return {"ready": valid, "reason": None if valid else "unknown"}
    except subprocess.TimeoutExpired:
        return {"ready": False, "reason": "timed-out"}
    except Exception:
        return {"ready": False, "reason": "unknown"}


def public_reachable(url):
    if not url:
        return {"checked": False, "reachable": None}
    try:
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password \
                or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
            return {"checked": True, "reachable": False}
        with urllib.request.urlopen(url, timeout=5) as response:
            return {"checked": True, "reachable": 200 <= response.status < 400}
    except Exception:
        return {"checked": True, "reachable": False}


def inspect_runtime(cid, report, timeout=3):
    inspected = json.loads(private_output(["docker", "inspect", "--format", "{{json .}}", cid], timeout))
    state, restarts = inspected.get("State", {}), inspected.get("RestartCount")
    status = state.get("Status")
    report["runtime"] = {"state": status if status in {"created", "running", "restarting", "exited", "paused", "dead", "removing"} else "unknown",
                         "restartCount": restarts if type(restarts) is int and restarts >= 0 else None,
                         "oomKilled": state.get("OOMKilled") is True}
    return inspected, state.get("Running") is True and not state.get("Restarting")


def verify(expected_sha, public_url=None):
    report = {"result": "not-ready", "reason": None, "sourceReady": False,
              "runtime": {"state": "unknown", "restartCount": None, "oomKilled": False},
              "buildRevision": None, "startupProfileSeen": False, "tradingSelectionSeen": False,
              "executionMode": None, "kill": None, "unresolvedCount": None,
              "tradingSelection": None, "miniApp": {"enabled": None, "ready": False},
              "candidateAppConfig": {"ready": False, "reason": "unknown"}, "ordersSubmitted": False}
    try:
        require(re.fullmatch("[0-9a-f]{40}", expected_sha or ""), "invalid-expected-sha")
        require(ROOT.resolve() == ROOT, "target-path-invalid")
        require(private_output(["git", "rev-parse", "HEAD"]) == expected_sha, "server-sha-mismatch")
        require(not private_output(["git", "status", "--porcelain", "--untracked-files=no"]), "tracked-source-dirty")
        report["sourceReady"] = True
        compose = ["docker", "compose", "--project-directory", str(ROOT), "--env-file", str(ROOT / ".env"),
                   "-f", str(ROOT / "docker-compose.yml")]
        cid = private_output(compose + ["ps", "-aq", SERVICE])
        require(re.fullmatch("[0-9a-f]{12,64}", cid), "service-container-unavailable")
        deadline = time.monotonic() + 10
        while True:
            require(time.monotonic() < deadline, "service-not-running")
            inspected, running = inspect_runtime(cid, report, min(3, max(0.1, deadline - time.monotonic())))
            if running:
                break
            time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        image = inspected.get("Image", "")
        require(re.fullmatch("sha256:[0-9a-f]{64}", image), "running-image-invalid")
        revision = inspected.get("Config", {}).get("Labels", {}).get("org.opencontainers.image.revision")
        report["buildRevision"] = revision if isinstance(revision, str) and re.fullmatch("[0-9a-f]{40}", revision) else None
        require(revision == expected_sha, "running-image-revision-mismatch")
        probe = (ROOT / "ops/profile_probe.mjs").read_text()
        snapshot = json.loads(private_output(["docker", "exec", cid, "node", "--input-type=module", "-e", probe]))
        config, state = snapshot["config"], snapshot["state"]
        mode, unresolved = config["execution"]["mode"], state["unresolved"]
        report["executionMode"] = mode if mode in {"disabled", "sandbox"} else None
        report["kill"] = state.get("execution.kill_switch") == "true"
        require(type(unresolved) is int and unresolved >= 0, "journal-state-invalid")
        report["unresolvedCount"] = unresolved
        require(mode == "disabled" and report["kill"] and unresolved == 0, "runtime-safety-not-disabled")
        selection = json.loads(private_output(["docker", "exec", cid, "node", "--input-type=module", "-e", SELECTION_PROBE]))
        tickers, revision = selection.get("tickers"), selection.get("revision")
        require(selection.get("strategyId") in STRATEGIES and type(revision) is int and 1 <= revision <= 2**53 - 1
                and isinstance(tickers, list) and 1 <= len(tickers) <= 40
                and all(isinstance(ticker, str) and re.fullmatch("[A-Z0-9.-]{1,16}", ticker) for ticker in tickers)
                and len(set(tickers)) == len(tickers), "trading-selection-invalid")
        report["tradingSelection"] = {"strategyId": selection["strategyId"], "revision": revision, "tickers": tickers}
        enabled = config["telegram"]["miniApp"]["enabled"] is True
        report["miniApp"] = {"enabled": enabled, "ready": not enabled}
        if enabled:
            deadline = time.monotonic() + 10
            while True:
                require(time.monotonic() < deadline, "mini-app-not-ready")
                checks = json.loads(private_output(["docker", "exec", cid, "node", "--input-type=module", "-e", HTTP_PROBE],
                                                  timeout=min(3, max(0.1, deadline - time.monotonic()))))
                keys = ("htmlControls", "javascriptCurrent", "unauthenticatedViewBlocked")
                ready = all(checks.get(key) is True for key in keys)
                report["miniApp"] = {"enabled": True, "ready": ready, **{key: checks.get(key) is True for key in keys}}
                if ready:
                    break
                time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        report["candidateAppConfig"] = candidate_diagnostic(image, probe, snapshot["env"])
        inspected, running = inspect_runtime(cid, report)
        require(running and inspected.get("Image") == image, "service-runtime-changed")
        try:
            logs = run(["docker", "logs", "--tail", "100", cid], timeout=3)
            for line in (logs.stdout + "\n" + logs.stderr).splitlines():
                try:
                    event = json.loads(line).get("event")
                    report["startupProfileSeen"] |= event == "daily-pilot-profile-loaded"
                    report["tradingSelectionSeen"] |= event == "trading-selection-loaded"
                except (ValueError, AttributeError):
                    pass
        except Exception:
            pass  # Historical log markers are informational, never readiness gates.
        report["result"] = "verified"
    except Refused as error:
        report["reason"] = error.code
    except subprocess.TimeoutExpired:
        report["reason"] = "readback-timed-out"
    except Exception:
        report["reason"] = "readback-invalid"
    report["publicHttps"] = public_reachable(public_url)
    return report


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise Refused("invalid-arguments")


def main():
    parser = SafeParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--public-url")
    try:
        args = parser.parse_args()
        report = verify(args.expected_sha, args.public_url)
    except Exception:
        report = {"result": "not-ready", "reason": "invalid-arguments", "ordersSubmitted": False}
    print(json.dumps(report, separators=(",", ":")))
    return 0 if report["result"] == "verified" else 1


if __name__ == "__main__":
    raise SystemExit(main())
