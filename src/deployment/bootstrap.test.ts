import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];
const isolatedEnv = { PATH: process.env.PATH };
const projectDirectory = resolve(import.meta.dirname, '../..');
function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'trading-bootstrap-'));
  directories.push(path);
  return path;
}
function runSetup(directory: string) {
  return spawnSync(process.execPath, ['ops/setup.mjs', '--directory', directory], { cwd: projectDirectory, env: isolatedEnv, encoding: 'utf8' });
}
function runDoctor(envFile: string, profile = 'telegram', extraEnv: Record<string, string> = {}) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'ops/doctor.mjs', '--env-file', envFile, '--profile', profile, '--json'], {
    cwd: projectDirectory, env: { ...isolatedEnv, ...extraEnv }, encoding: 'utf8',
  });
}
function fixtureEnvironment(directory: string, text: string): string {
  const path = join(directory, '.env');
  writeFileSync(path, text, { mode: 0o600 });
  return path;
}

afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe('local deployment setup', () => {
  it('creates a private disabled configuration and relay directory without values in output', () => {
    const directory = temporaryDirectory();
    const result = runSetup(directory);
    expect(result.status).toBe(0);
    const contents = readFileSync(join(directory, '.env'), 'utf8');
    expect(contents).toContain('T_INVEST_EXECUTION_MODE=disabled');
    expect(statSync(join(directory, '.env')).mode & 0o777).toBe(0o600);
    expect(statSync(join(directory, '.trading')).mode & 0o777).toBe(0o700);
    expect(statSync(join(directory, '.trading', 'relay')).mode & 0o777).toBe(0o700);
    expect(result.stdout).not.toContain('T_INVEST_TOKEN=');
  });

  it('preserves an existing configuration exactly while making file permissions private', () => {
    const directory = temporaryDirectory();
    const content = '# private marker\nT_INVEST_TOKEN=secret-existing-token\nT_INVEST_EXECUTION_MODE=sandbox\n';
    const path = fixtureEnvironment(directory, content);
    chmodSync(path, 0o644);
    const first = runSetup(directory);
    const second = runSetup(directory);
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    expect(readFileSync(path, 'utf8')).toBe(content);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(first.stdout + first.stderr).not.toContain('secret-existing-token');
  });

  it('does not follow an environment symlink or change the target', () => {
    const directory = temporaryDirectory();
    const outside = join(directory, 'unrelated-private-file');
    writeFileSync(outside, 'preserve-target', { mode: 0o644 });
    symlinkSync(outside, join(directory, '.env'));
    const result = runSetup(directory);
    expect(result.status).toBe(1);
    expect(readFileSync(outside, 'utf8')).toBe('preserve-target');
    expect(statSync(outside).mode & 0o777).toBe(0o644);
    expect(existsSync(join(directory, '.trading'))).toBe(false);
  });

  it('secures existing data directories without changing their files', () => {
    const directory = temporaryDirectory();
    const data = join(directory, '.trading');
    const relay = join(data, 'relay');
    mkdirSync(relay, { recursive: true, mode: 0o755 });
    chmodSync(data, 0o755); chmodSync(relay, 0o755);
    writeFileSync(join(data, 'journal-fixture'), 'preserve-journal');
    writeFileSync(join(relay, 'secret-fixture'), 'preserve-relay-secret');
    const result = runSetup(directory);
    expect(result.status).toBe(0);
    expect(statSync(data).mode & 0o777).toBe(0o700);
    expect(statSync(relay).mode & 0o777).toBe(0o700);
    expect(readFileSync(join(data, 'journal-fixture'), 'utf8')).toBe('preserve-journal');
    expect(readFileSync(join(relay, 'secret-fixture'), 'utf8')).toBe('preserve-relay-secret');
  });

  it.each(['.trading', 'relay'])('refuses a %s directory symlink without modifying its target', (which) => {
    const directory = temporaryDirectory();
    const outside = join(directory, 'unrelated-directory');
    mkdirSync(outside, { mode: 0o755 });
    writeFileSync(join(outside, 'preserve-file'), 'preserve-directory-target');
    if (which === '.trading') symlinkSync(outside, join(directory, '.trading'));
    else {
      mkdirSync(join(directory, '.trading'), { mode: 0o700 });
      symlinkSync(outside, join(directory, '.trading', 'relay'));
    }
    const result = runSetup(directory);
    expect(result.status).toBe(1);
    expect(statSync(outside).mode & 0o777).toBe(0o755);
    expect(readFileSync(join(outside, 'preserve-file'), 'utf8')).toBe('preserve-directory-target');
  });
});

describe('local configuration doctor', () => {
  it('uses the service schema and returns safe presence checks without secret values or identifiers', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-secret-marker\nTELEGRAM_BOT_TOKEN=telegram-secret-marker\nTELEGRAM_ALLOWED_CHAT_IDS=9912345\nT_INVEST_LIVE_ACCOUNT_ID=account-secret-marker\n');
    const result = runDoctor(path);
    expect(result.status).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ profile: 'telegram', configurationReady: true, networkChecked: false, brokerWrites: false });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'EXECUTION_DISABLED', status: 'ok' }));
    for (const secret of ['readonly-secret-marker', 'telegram-secret-marker', '9912345', 'account-secret-marker']) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });

  it('blocks duplicated credential roles without printing the validation exception or token', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=duplicate-secret-marker\nT_INVEST_SANDBOX_TOKEN=duplicate-secret-marker\nTELEGRAM_BOT_TOKEN=telegram-secret-marker\n');
    const result = runDoctor(path);
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).checks).toContainEqual(expect.objectContaining({ code: 'CONFIGURATION', status: 'error' }));
    expect(result.stdout + result.stderr).not.toContain('duplicate-secret-marker');
  });

  it('rejects an empty selected watchlist through the shared deployment preflight without exposing private values', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-secret-marker\nTELEGRAM_BOT_TOKEN=telegram-secret-marker\nTELEGRAM_ALLOWED_CHAT_IDS=9912345\nT_INVEST_LIVE_ACCOUNT_ID=account-secret-marker\nT_INVEST_INTRADAY_UNIVERSE=watchlist\nT_INVEST_INTRADAY_WATCHLIST=[]\n');
    const result = runDoctor(path);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({ configurationReady: false, networkChecked: false, brokerWrites: false });
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'CONFIGURATION', status: 'error' }));
    expect(report.checks).not.toContainEqual(expect.objectContaining({ code: 'CONFIGURATION', status: 'ok' }));
    for (const secret of ['readonly-secret-marker', 'telegram-secret-marker', '9912345', 'account-secret-marker']) {
      expect(result.stdout + result.stderr).not.toContain(secret);
    }
  });

  it('reports missing required tokens, and leaves onboarding without chat IDs as a warning', () => {
    const missing = runDoctor(fixtureEnvironment(temporaryDirectory(), ''));
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stdout).checks).toContainEqual(expect.objectContaining({ code: 'READ_ONLY_TOKEN', status: 'error' }));
    const onboarding = runDoctor(fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-marker\nTELEGRAM_BOT_TOKEN=bot-marker\n'));
    expect(onboarding.status).toBe(0);
    expect(JSON.parse(onboarding.stdout).checks).toContainEqual(expect.objectContaining({ code: 'TELEGRAM_ACCESS', status: 'warning' }));
  });

  it('uses process environment precedence consistently with Node env-file startup', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-marker\nTELEGRAM_BOT_TOKEN=bot-marker\n');
    const result = runDoctor(path, 'telegram', { T_INVEST_EXECUTION_MODE: 'invalid-secret-marker' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).checks).toContainEqual(expect.objectContaining({ code: 'CONFIGURATION', status: 'error' }));
    expect(result.stdout + result.stderr).not.toContain('invalid-secret-marker');
  });

  it('requires a separate sandbox token and diagnoses disabled guards', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-marker\nTELEGRAM_BOT_TOKEN=bot-marker\nT_INVEST_EXECUTION_MODE=sandbox\n');
    const result = runDoctor(path, 'sandbox');
    expect(result.status).toBe(1);
    const checks = JSON.parse(result.stdout).checks;
    expect(checks).toContainEqual(expect.objectContaining({ code: 'SANDBOX_TOKEN', status: 'error' }));
    expect(checks).toContainEqual(expect.objectContaining({ code: 'SANDBOX_PROTECTION', status: 'warning' }));
  });

  it('rejects readable-by-others .env and refuses symlinks', () => {
    const directory = temporaryDirectory();
    const path = fixtureEnvironment(directory, 'T_INVEST_TOKEN=readonly-marker\n');
    chmodSync(path, 0o644);
    const insecure = runDoctor(path, 'mcp');
    expect(insecure.status).toBe(1);
    expect(JSON.parse(insecure.stdout).checks).toContainEqual(expect.objectContaining({ code: 'ENV_PERMISSIONS', status: 'error' }));
    const link = join(directory, 'env-link');
    symlinkSync(path, link);
    const linked = runDoctor(link, 'mcp');
    expect(linked.status).toBe(1);
    expect(JSON.parse(linked.stdout).checks).toContainEqual(expect.objectContaining({ code: 'ENV_FILE', status: 'error' }));
  });

  it.each([
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['NODE_OPTIONS', '--tls-min-v1.0'],
    ['NODE_OPTIONS', '--tls-min-v1.1'],
  ])('blocks unsafe TLS setting %s with fixed diagnostics', (key, value) => {
    const path = fixtureEnvironment(temporaryDirectory(), `T_INVEST_TOKEN=readonly-secret-marker\nTELEGRAM_BOT_TOKEN=bot-secret-marker\n${key}=${value}\n`);
    const result = runDoctor(path);
    expect(result.status).toBe(1);
    const report = JSON.parse(result.stdout);
    expect(report.configurationReady).toBe(false);
    expect(report.checks).toContainEqual(expect.objectContaining({ code: 'TLS_VERIFICATION', status: 'error' }));
    expect(result.stdout + result.stderr).not.toContain('readonly-secret-marker');
    expect(result.stdout + result.stderr).not.toContain('bot-secret-marker');
    expect(result.stdout + result.stderr).not.toContain(value === '0' ? 'NODE_TLS_REJECT_UNAUTHORIZED=0' : value);
  });

  it('detects a TLS disable inherited from the launcher even when the file does not contain it', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-marker\n');
    const result = runDoctor(path, 'mcp', { NODE_TLS_REJECT_UNAUTHORIZED: '0' });
    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).checks).toContainEqual(expect.objectContaining({ code: 'TLS_VERIFICATION', status: 'error' }));
  });

  it('accepts TLS 1.2+ without a verification override', () => {
    const path = fixtureEnvironment(temporaryDirectory(), 'T_INVEST_TOKEN=readonly-marker\nNODE_OPTIONS=--tls-min-v1.2\n');
    const result = runDoctor(path, 'mcp');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout).checks).toContainEqual(expect.objectContaining({ code: 'TLS_VERIFICATION', status: 'ok' }));
  });
});
