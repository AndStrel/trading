"""Install a stdin-only sandbox credential using the guarded profile migration."""
import re
import sys
import prepare_daily_profile as profile


def configure(raw):
    # Reject dotenv syntax, multiple lines and oversized input. Never echo input.
    token = raw.removesuffix("\n")
    profile.require(re.fullmatch(r"[A-Za-z0-9_.-]{20,4096}", token), "invalid-secret-format")
    original_validate = profile.validate

    def validate(snapshot, migrated=False):
        original_validate(snapshot, migrated)
        env = snapshot["env"]
        profile.require(env.get("T_INVEST_TRADING_TOKEN_ROLE") == "live", "role-not-live")
        profile.require(snapshot["config"]["livePilot"]["capitalRub"] == 500, "capital-mismatch")
        profile.require(snapshot["config"]["execution"]["sandboxInitialBalanceRub"] == 1000,
                        "sandbox-balance-mismatch")
        if migrated:
            profile.require(snapshot["config"]["execution"].get("token") == token,
                            "sandbox-token-not-resolved")

    profile.validate = validate
    profile.FIXED = {"T_INVEST_SANDBOX_TOKEN": token}


if __name__ == "__main__":
    try:
        configure(sys.stdin.read(4098))
    except Exception:
        print('{"result":"refused","reason":"invalid-secret-format","ordersSubmitted":false}')
        raise SystemExit(1) from None
    raise SystemExit(profile.main())
