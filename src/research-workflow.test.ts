import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/research-dataset.yml', 'utf8');
const remote = workflow.split("<<'REMOTE' | tee \"$report_path\"\n")[1]!
  .split('          REMOTE\n')[0]!.replace(/^          /gm, '');
// Execute the actual workflow body via stdin, just like ssh ... bash -s.
const body = remote.slice(remote.indexOf("IFS=',' read"));
function run(script: string, failCatalog = false) {
  return spawnSync('bash', ['-s'], {
    input: `set -Eeuo pipefail
RESEARCH_YEARS=2023,2024,2025
RESEARCH_TICKERS=SBER,GAZP
RESEARCH_LOOKBACK_MINUTES=30
RESEARCH_STEP_MINUTES=5
RESEARCH_OUTCOME_MINUTES=15,30,60
docker() {
  # Model a subprocess draining inherited stdin, even when its command ignores it.
  cat >/dev/null
  case "$*" in
    *history-import.js*) echo imported; return 0 ;;
    *research-catalog.js*) echo catalog; return ${failCatalog ? 9 : 0} ;;
    *) return 28 ;;
  esac
}
${script}`,
    encoding: 'utf8', timeout: 5000,
  });
}

describe('research workflow stdin isolation', () => {
  it('reproduces the premature EOF without isolation', () => {
    const result = run(body.replaceAll('</dev/null', ''));
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain('research_status=ok');
  });
  it('continues after both failed probes and executes import and catalog', () => {
    const result = run(body);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('api_probe_host=invest-public-api.tinkoff.ru exit=28');
    expect(result.stdout).toContain('history_source=moex');
    expect(result.stdout).toContain('imported');
    expect(result.stdout).toContain('catalog');
    expect(result.stdout).toContain('research_status=ok');
  });

  it('does not keep the old long outer retry loop', () => {
    expect(body).not.toContain('history_import_retry=');
    expect(body).not.toContain('max_attempts=5');
    expect(body).toContain('--source "$history_source"');
  });
  it('fails when catalog fails and does not emit success', () => {
    const result = run(body, true);
    expect(result.status).toBe(9);
    expect(result.stdout).not.toContain('research_status=ok');
  });
});
