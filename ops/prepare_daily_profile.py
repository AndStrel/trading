"""Fixed non-trading profile migration. No broker client, funding or order API."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path("/opt/andstrel/trading")
SERVICE = "telegram-service"
STAGE = "start"
FIXED = {
    "T_INVEST_TRADING_TOKEN_ROLE": "live",
    "T_INVEST_LIVE_CAPITAL_RUB": "500",
    "T_INVEST_SANDBOX_INITIAL_BALANCE_RUB": "1000",
}


class Refused(Exception):
    def __init__(self, code="guard"):
        self.code = code


def require(value, code="guard"):
    if not value:
        raise Refused(code)


def command(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, text=True,
                            cwd=ROOT, timeout=90)
    # Never propagate stderr, Compose output, broker credentials or account IDs.
    if result.returncode != 0:
        try:
            failure = json.loads(result.stdout).get("probeFailure")
        except (ValueError, AttributeError):
            failure = None
        raise Refused("probe-" + failure if failure in {"config", "sqlite", "ack"} else "command-failed")
    return result.stdout.strip()


def patch_env(original):
    text = original.decode("utf-8")
    require("\x00" not in text)
    for key, value in FIXED.items():
        pattern = re.compile(r"^[ \t]*(?:export[ \t]+)?" + key +
                             r"[ \t]*=[^\r\n]*(?:\r?\n|$)", re.MULTILINE)
        matches = list(pattern.finditer(text))
        require(len(matches) <= 1)
        replacement = key + "=" + value + "\n"
        if matches:
            match = matches[0]
            text = text[:match.start()] + replacement + text[match.end():]
        else:
            text += ("" if not text or text.endswith("\n") else "\n") + replacement
    return text.encode("utf-8")


def validate(snapshot, migrated=False):
    env, config = snapshot["env"], snapshot["config"]
    ex, pilot = config["execution"], config["livePilot"]
    daily, weekly = config["strategies"]["intraday"], config["strategies"]["swing"]
    require(ex["mode"] == "disabled", "execution-not-disabled")
    require(pilot["prepare"], "preparation-not-enabled")
    require(not any(ex[k] for k in ("sandboxProtectionEnabled", "sandboxLossGuardEnabled",
                                    "sandboxSessionCloseEnabled")), "monitor-enabled")
    require(config.get("token") and env.get("T_INVEST_TRADING_TOKEN", "").strip())
    require(daily.get("accountId") and weekly.get("accountId"), "strategy-account-missing")
    require(daily["accountId"] != weekly["accountId"], "strategy-accounts-not-distinct")
    require(pilot.get("accountId") == daily["accountId"], "pilot-account-not-daily")
    require(not daily["allowShort"])
    require(0 < pilot["maxTradeRiskRub"] <= 20)
    require(0 < pilot["maxDailyRiskRub"] <= 60 and 0 < pilot["maxDailyLossRub"] <= 60)
    if "state" in snapshot:
        state = snapshot["state"]
        require(state["execution.kill_switch"] == "true", "kill-not-enabled")
        require(state["execution.kill_generation"], "kill-generation-missing")
        require(state["unresolved"] == 0, "outstanding-order-present")
        # Full ACK schema/account binding is validated by the read-only JS probe.
        require(state["execution.sandbox_bootstrap_v1"] and state["execution.sandbox_account_id"])
    if migrated:
        require(all(env.get(k) == v for k, v in FIXED.items()))
        require(pilot["capitalRub"] == 500 and ex["sandboxInitialBalanceRub"] == 1000)
        require(pilot.get("token") == env["T_INVEST_TRADING_TOKEN"].strip())


def private_file(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def atomic_replace(path, data):
    fd, name = tempfile.mkstemp(prefix=".profile-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
        directory_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def migrate(expected_sha, apply):
    global STAGE
    STAGE = "source"
    require(re.fullmatch("[0-9a-f]{40}", expected_sha))
    require(ROOT.resolve() == ROOT)
    require(command(["git", "rev-parse", "HEAD"]) == expected_sha, "server-sha-mismatch")
    require(not command(["git", "status", "--porcelain", "--untracked-files=no"]), "tracked-source-dirty")
    env_path = ROOT / ".env"
    STAGE = "env-file"
    require(env_path.is_file() and not env_path.is_symlink(), "env-file-invalid")
    require(env_path.stat().st_uid == os.geteuid(), "env-owner-mismatch")
    require(env_path.stat().st_mode & 0o777 == 0o600, "env-permissions-invalid")
    before = env_path.read_bytes()
    candidate = patch_env(before)
    compose = ["docker", "compose", "--project-directory", str(ROOT),
               "--env-file", str(env_path), "-f", str(ROOT / "docker-compose.yml")]
    cid = command(compose + ["ps", "-q", SERVICE])
    STAGE = "running-image"
    require(cid and "\n" not in cid)
    image = command(["docker", "inspect", "--format", "{{.Image}}", cid])
    require(re.fullmatch("sha256:[0-9a-f]{64}", image))
    probe = (ROOT / "ops/profile_probe.mjs").read_text()

    def snapshot():
        current = command(compose + ["ps", "-q", SERVICE])
        require(current and "\n" not in current)
        require(command(["docker", "inspect", "--format", "{{.Image}}", current]) == image)
        result = json.loads(command(["docker", "exec", current, "node",
                                     "--input-type=module", "-e", probe]))
        validate(result)
        return result

    STAGE = "journal-and-current-config"
    initial = snapshot()
    # Private files remain outside Git; only the original env backup is durable.
    with tempfile.TemporaryDirectory(prefix="trading-profile-", dir=ROOT.parent) as tmp:
        folder = Path(tmp)
        private_file(folder / "candidate.env", candidate)
        source = (ROOT / "docker-compose.yml").read_text()
        require(source.count("\n      - .env\n") == 1)
        private_file(folder / "compose.yml", source.replace(
            "\n      - .env\n", "\n      - " + str(folder / "candidate.env") + "\n").encode())
        STAGE = "candidate-compose"
        resolved = json.loads(command(["docker", "compose", "--project-directory", str(ROOT),
            "--env-file", str(folder / "candidate.env"), "-f", str(folder / "compose.yml"),
            "config", "--format", "json"]))
        new_env = dict(initial["env"])
        new_env.update(resolved["services"][SERVICE]["environment"])
        # Same application image validates credentials/config, with no network/data/logs.
        STAGE = "candidate-app-config"
        checked = json.loads(command(["docker", "run", "--rm", "--network", "none",
            "-i", "--log-driver", "none", "--read-only", "--cap-drop", "ALL",
            "--security-opt", "no-new-privileges:true", "--entrypoint", "node",
            image, "--input-type=module", "-e", probe, "--", "--candidate"], json.dumps(new_env)))
        STAGE = "candidate-safety"
        validate(checked, migrated=True)
        require(all(initial["env"].get(k) == checked["env"].get(k)
                    for k in initial["env"] if k not in FIXED))
        STAGE = "pre-write-recheck"
        require(snapshot() == initial and env_path.read_bytes() == before)
        if not apply:
            print('{"result":"dry-run-ok","execution":"disabled","kill":true}')
            return
        # Serialize cooperative operations; re-check uncooperative changes before every write.
        STAGE = "private-backup"
        backup_dir = Path(tempfile.mkdtemp(prefix="trading-profile-backup-", dir=ROOT.parent))
        private_file(backup_dir / "env.before", before)
        pin = folder / "image.yml"
        private_file(pin, ("services:\n  " + SERVICE + ":\n    image: " + image + "\n").encode())
        restart = compose + ["-f", str(pin), "up", "-d", "--no-build", "--pull", "never",
                             "--no-deps", "--force-recreate", SERVICE]
        require(snapshot() == initial and env_path.read_bytes() == before)
        changed = False
        try:
            changed = True
            atomic_replace(env_path, candidate)
            STAGE = "restart"
            command(restart)
            STAGE = "runtime-readback"
            current = snapshot()
            validate(current, migrated=True)
            require(current["state"] == initial["state"])
            require(all(current["env"].get(k) == v for k, v in initial["env"].items()
                        if k not in FIXED and k != "HOSTNAME"))
            require(env_path.read_bytes() == candidate)
        except Exception:
            # Never overwrite a discovered concurrent operator edit during rollback.
            if changed and env_path.read_bytes() == candidate:
                atomic_replace(env_path, before)
                try:
                    command(restart)
                    restored = snapshot()
                    require(restored["state"] == initial["state"])
                    require(restored["config"] == initial["config"])
                    require(all(restored["env"].get(k) == v for k, v in initial["env"].items()
                                if k != "HOSTNAME"))
                except Exception:
                    print('{"result":"failed","rollback":"unverified","executionNotEnabledByTool":true}')
                    raise Refused() from None
                print('{"result":"failed","rollback":"verified","executionNotEnabledByTool":true}')
            else:
                print('{"result":"failed","rollback":"not-applied-or-concurrent-change"}')
            raise Refused() from None
    print('{"result":"applied","role":"live","capitalRub":500,"sandboxBalanceRub":1000,'
          '"execution":"disabled","kill":true,"imageUnchanged":true}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected-sha", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        with open(ROOT.parent / ".trading-profile.lock", "a") as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            migrate(args.expected_sha, args.apply)
    except Exception as error:
        # No raw exception, subprocess stdout/stderr or private data in GitHub.
        print(json.dumps({"result": "refused-or-failed", "stage": STAGE,
                          "reason": error.code if isinstance(error, Refused) else "internal",
                          "details": "private", "ordersSubmitted": False}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
