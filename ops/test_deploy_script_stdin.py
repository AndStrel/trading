"""Execute the actual remote Bash body against local, non-networking stubs."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = Path(__file__).resolve().parents[1]
SHA = "1" * 40


def remote_script():
    source = (ROOT / ".github/workflows/deploy-telegram.yml").read_text()
    return textwrap.dedent(source.split("<<'REMOTE'\n", 1)[1].split("\n          REMOTE", 1)[0])


class DeployScriptStdin(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="deploy-stdin-unit-")
        self.directory = Path(self.temp.name)
        self.project = self.directory / "trading"
        self.project.mkdir()
        (self.project / ".git").mkdir()
        self.original = b"T_INVEST_TOKEN=synthetic-read-only\nT_INVEST_EXECUTION_MODE=disabled\n"
        (self.project / ".env").write_bytes(self.original)
        self.bin = self.directory / "bin"
        self.bin.mkdir()
        self.log = self.directory / "commands.jsonl"
        for name in ("git", "docker", "python3"):
            executable = self.bin / name
            executable.write_text(f"#!{sys.executable}\n" + textwrap.dedent("""
                import json, os, sys
                from pathlib import Path
                tool, args = Path(sys.argv[0]).name, sys.argv[1:]
                with open(os.environ['SYNTHETIC_DEPLOY_LOG'], 'a') as output:
                    output.write(json.dumps({'tool': tool, 'args': args}) + '\\n')
                if tool == 'docker' and 'run' in args:
                    # Compose run defaults interactive=true: emulate the attach
                    # copier draining Bash's remaining script, not Node reading it.
                    if '--interactive=false' not in args:
                        sys.stdin.read()
                    failed = os.environ.get('SYNTHETIC_DEPLOY_FAILURE') == 'run'
                    print(json.dumps({'configReady': not failed}))
                    raise SystemExit(1 if failed else 0)
                if tool == 'docker' and 'build' in args:
                    raise SystemExit(1 if os.environ.get('SYNTHETIC_DEPLOY_FAILURE') == 'build' else 0)
                if tool == 'python3':
                    assert args[0] == 'ops/verify_strategy_service.py'
                    assert args[args.index('--expected-sha') + 1] == os.environ['SYNTHETIC_EXPECTED_SHA']
                    failed = os.environ.get('SYNTHETIC_DEPLOY_FAILURE') == 'verify'
                    print(json.dumps({'runtimeReadback': not failed}))
                    raise SystemExit(1 if failed else 0)
            """))
            executable.chmod(0o700)

    def tearDown(self):
        self.temp.cleanup()

    def execute(self, failure="", unsafe=False):
        script = remote_script().replace('deployment_path="/opt/andstrel/trading"',
                                         'deployment_path="' + str(self.project) + '"')
        script = script.replace('parent_path="/opt/andstrel"', 'parent_path="' + str(self.directory) + '"')
        if unsafe:
            script = script.replace('--interactive=false', '').replace('-T ', '').replace('</dev/null', '')
        result = subprocess.run(['bash', '-s', '--', SHA], input=script + '\nprintf "AFTER_REMOTE_REACHED\\n"\n',
                                capture_output=True, text=True, timeout=5,
                                env={'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
                                     'SYNTHETIC_DEPLOY_LOG': str(self.log), 'SYNTHETIC_EXPECTED_SHA': SHA,
                                     'SYNTHETIC_DEPLOY_FAILURE': failure})
        calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        self.assertEqual((self.project / '.env').read_bytes(), self.original)
        return result, calls

    @staticmethod
    def stages(calls):
        stages = []
        for call in calls:
            if call['tool'] == 'python3':
                stages.append('verify')
            elif call['tool'] == 'docker':
                stages.extend(stage for stage in ('build', 'run', 'up', 'ps', 'logs') if stage in call['args'])
        return stages

    def test_default_interactive_compose_reproduces_silent_script_truncation(self):
        result, calls = self.execute(unsafe=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn('"configReady": true', result.stdout)
        self.assertEqual(self.stages(calls), ['build', 'run'])
        self.assertNotIn('AFTER_REMOTE_REACHED', result.stdout)

    def test_actual_protected_workflow_reaches_up_and_runtime_verifier(self):
        result, calls = self.execute()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.stages(calls), ['build', 'run', 'up', 'ps', 'logs', 'verify'])
        self.assertIn('"runtimeReadback": true', result.stdout)
        self.assertIn('AFTER_REMOTE_REACHED', result.stdout)
        preflight = next(call for call in calls if call['tool'] == 'docker' and 'run' in call['args'])
        self.assertIn('--interactive=false', preflight['args'])
        self.assertIn('-T', preflight['args'])
        self.assertIn('</dev/null', next(line for line in remote_script().splitlines() if 'dist/strategy-config-preflight.js' in line))

    def test_build_failure_never_runs_preflight_up_or_verifier(self):
        result, calls = self.execute(failure='build')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages(calls), ['build'])
        self.assertNotIn('AFTER_REMOTE_REACHED', result.stdout)

    def test_preflight_failure_never_replaces_service_or_runs_verifier(self):
        result, calls = self.execute(failure='run')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages(calls), ['build', 'run'])
        self.assertNotIn('AFTER_REMOTE_REACHED', result.stdout)

    def test_verifier_failure_is_not_a_successful_deployment(self):
        result, calls = self.execute(failure='verify')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(self.stages(calls), ['build', 'run', 'up', 'ps', 'logs', 'verify'])
        self.assertIn('"runtimeReadback": false', result.stdout)
        self.assertNotIn('AFTER_REMOTE_REACHED', result.stdout)


if __name__ == '__main__':
    unittest.main()
