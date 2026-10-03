"""Pinned existing-service account preparation read-back; never enables trading."""
import argparse
import json
import math
from pathlib import Path
import re
import subprocess
import time


ROOT = Path("/opt/andstrel/trading")
PROJECT = "andstrel-trading"
SERVICE = "telegram-service"
INSPECT = ('{"id":{{json .Id}},"image":{{json .Image}},'
           '"running":{{json .State.Running}},"restarting":{{json .State.Restarting}},'
           '"oomKilled":{{json .State.OOMKilled}},"status":{{json .State.Status}},'
           '"restartCount":{{json .RestartCount}},'
           '"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
           '"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
           '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
           '"directory":{{json (index .Config.Labels "com.docker.compose.project.working_dir")}}}')
LIVE_BLOCKER = "Live-отправка закрыта: ещё нужны защитный стоп, сверка после сбоев, учёт фактического убытка и sandbox-проверка полного цикла."
BLOCKERS = {
    "Подготовка дневного пилота выключена.": "preparation-disabled",
    "Не настроен токен для проверки реального дневного счёта: выберите live-роль существующего торгового токена или задайте live-токен.": "live-read-credential-missing",
    "Не выбран отдельный дневной счёт.": "daily-account-not-selected",
    "Доступ к выбранному обычному брокерскому счёту не подтверждён.": "daily-account-access-unconfirmed",
    "Тариф изменился: требуется повторная проверка расходов.": "tariff-costs-unconfirmed",
    "На счёте уже есть позиции: автоматическое управление ими запрещено.": "account-has-positions",
    "На счёте есть активные заявки или стопы.": "active-orders-or-stops",
    "Для изолированного пилота допускаются только рубли.": "non-rub-cash",
    "На счёте есть заблокированные деньги.": "cash-blocked",
    "Счёт ещё не пополнен до суммы дневного пилота.": "pilot-cash-insufficient",
    "Проверка брокера не завершена или ответ неполный. Счёт не признан готовым.": "broker-read-unconfirmed",
    LIVE_BLOCKER: "live-execution-not-implemented",
}
PROOF_GAPS = ["live-execution-not-implemented", "sandbox-strategy-cycle-unconfirmed",
              "exact-cash-reconciliation-unconfirmed", "strategy-admission-unconfirmed"]


class Refused(Exception):
    def __init__(self, code):
        self.code = code


def require(condition, code):
    if not condition:
        raise Refused(code)


def private_output(args, deadline, timeout=5, failure="readback-command-failed"):
    remaining = deadline - time.monotonic()
    require(remaining > 0, "readback-timed-out")
    result = subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                            cwd=ROOT, timeout=min(timeout, remaining), check=False)
    require(result.returncode == 0, failure)
    require(len(result.stdout) <= 65536, "readback-payload-invalid")
    return result.stdout.strip()


def inspect(cid, expected_sha, deadline):
    state = json.loads(private_output(["docker", "inspect", "--format", INSPECT, cid], deadline))
    require(isinstance(state, dict), "runtime-readback-invalid")
    identity = state.get("id")
    require(isinstance(identity, str) and re.fullmatch("[0-9a-f]{64}", identity)
            and identity.startswith(cid), "runtime-identity-mismatch")
    require(state.get("project") == PROJECT and state.get("service") == SERVICE
            and state.get("directory") == str(ROOT), "runtime-target-mismatch")
    require(state.get("running") is True and state.get("restarting") is False
            and state.get("oomKilled") is False and state.get("status") == "running", "service-not-running")
    require(type(state.get("restartCount")) is int and state["restartCount"] >= 0, "runtime-readback-invalid")
    require(isinstance(state.get("image"), str) and re.fullmatch("sha256:[0-9a-f]{64}", state["image"]), "runtime-readback-invalid")
    require(state.get("revision") == expected_sha, "running-image-revision-mismatch")
    return state


def project_preflight(payload):
    require(isinstance(payload, dict), "pilot-preflight-payload-invalid")
    require(payload.get("executionMode") == "disabled", "execution-not-disabled")
    require(payload.get("liveSubmissionAllowed") is False, "live-submission-not-forbidden")
    for key in ("pilotPreparing", "liveTokenPresent", "liveAccountConfigured", "accountChecksPassed"):
        require(type(payload.get(key)) is bool, "pilot-preflight-payload-invalid")
    limits = {}
    bounds = {"capitalRub": 1000, "maxTradeRiskRub": 20, "maxPositionRub": 1000,
              "maxDailyRiskRub": 60, "maxDailyLossRub": 60, "commissionRate": 0.1}
    for key, maximum in bounds.items():
        value = payload.get(key)
        require(type(value) in (int, float) and math.isfinite(value) and 0 < value <= maximum,
                "daily-pilot-limits-invalid")
        limits[key] = value
    require(limits["commissionRate"] >= 0.003 and limits["maxPositionRub"] <= limits["capitalRub"]
            and limits["maxTradeRiskRub"] <= limits["maxDailyRiskRub"], "daily-pilot-limits-invalid")
    raw = payload.get("blockers")
    require(isinstance(raw, list) and 1 <= len(raw) <= 32
            and all(isinstance(item, str) and len(item) <= 1024 for item in raw), "pilot-preflight-payload-invalid")
    codes = list(dict.fromkeys(BLOCKERS.get(item, "preflight-blocker-unclassified") for item in raw))
    passed = payload["accountChecksPassed"]
    if passed:
        require(payload["pilotPreparing"] and payload["liveTokenPresent"] and payload["liveAccountConfigured"]
                and codes == ["live-execution-not-implemented"], "pilot-preflight-payload-invalid")
    return passed, payload["pilotPreparing"], limits, codes


def verify(expected_sha):
    report = {"scope": "live-account-read-only", "result": "not-ready", "reason": None,
              "sourceReady": False, "buildRevision": None, "runtime": {"running": False, "restartCount": None},
              "preflightInvoked": False, "executionMode": None, "pilotPreparing": None,
              "accountChecksPassed": False, "liveSubmissionAllowed": False, "brokerWrites": False,
              "blockers": list(PROOF_GAPS), "limits": None}
    deadline = time.monotonic() + 45
    try:
        require(re.fullmatch("[0-9a-f]{40}", expected_sha or ""), "invalid-expected-sha")
        require(ROOT.resolve() == ROOT, "target-path-invalid")
        require(private_output(["git", "rev-parse", "HEAD"], deadline) == expected_sha, "server-sha-mismatch")
        require(not private_output(["git", "status", "--porcelain", "--untracked-files=no"], deadline), "tracked-source-dirty")
        report["sourceReady"] = True
        # Resolve by fixed Compose labels, without loading/copying .env or creating a container.
        cid = private_output(["docker", "ps", "--all", "--filter", f"label=com.docker.compose.project={PROJECT}",
                              "--filter", f"label=com.docker.compose.service={SERVICE}", "--format", "{{.ID}}"], deadline)
        require(re.fullmatch("[0-9a-f]{12,64}", cid), "service-container-unavailable")
        before = inspect(cid, expected_sha, deadline)
        report["buildRevision"] = expected_sha
        report["runtime"] = {"running": True, "restartCount": before["restartCount"]}
        report["preflightInvoked"] = True
        payload = json.loads(private_output(["docker", "exec", cid, "node", "dist/pilot-preflight.js"],
                                           deadline, timeout=30, failure="pilot-preflight-failed"))
        passed, preparing, limits, codes = project_preflight(payload)
        after = inspect(cid, expected_sha, deadline)
        require((after["id"], after["image"], after["restartCount"]) ==
                (before["id"], before["image"], before["restartCount"]), "service-runtime-changed")
        report.update(executionMode="disabled", pilotPreparing=preparing, accountChecksPassed=passed, limits=limits)
        report["blockers"] = list(dict.fromkeys(codes + PROOF_GAPS))
        report["result"] = "account-checks-passed" if passed else "not-ready"
        report["reason"] = None if passed else "account-checks-failed"
    except Refused as error:
        report["reason"] = error.code
    except subprocess.TimeoutExpired:
        report["reason"] = "readback-timed-out"
    except Exception:
        report["reason"] = "readback-invalid"
    return report


class SafeParser(argparse.ArgumentParser):
    def error(self, message):
        raise Refused("invalid-arguments")


def main(argv=None):
    parser = SafeParser(description=__doc__)
    parser.add_argument("--expected-sha", required=True)
    try:
        args = parser.parse_args(argv)
        report = verify(args.expected_sha)
    except Exception:
        report = {"result": "not-ready", "reason": "invalid-arguments", "liveSubmissionAllowed": False, "brokerWrites": False}
    print(json.dumps(report, separators=(",", ":")))
    return 0 if report["result"] == "account-checks-passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
