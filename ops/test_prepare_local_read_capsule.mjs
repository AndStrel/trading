import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test, { afterEach, mock } from 'node:test';
import { prepareLocalReadCapsule } from './prepare_local_read_capsule.mjs';

const helper = fileURLToPath(new URL('./prepare_local_read_capsule.mjs', import.meta.url));
const directories = [];
const privateMarkers = ['sandbox-private-marker', 'live-private-marker', 'telegram-private-marker', 'account-private-marker'];
function fixture() {
  const directory = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'local-capsule-test-'));
  directories.push(directory);
  fs.chmodSync(directory, 0o700);
  const source = join(directory, 'snapshot.json'), output = join(directory, 'capsule.json');
  const payload = { env: { T_INVEST_TOKEN: 'synthetic-read-token', T_INVEST_SANDBOX_TOKEN: privateMarkers[0],
    T_INVEST_TRADING_TOKEN: privateMarkers[1], T_INVEST_LIVE_TOKEN: privateMarkers[1],
    TELEGRAM_BOT_TOKEN: privateMarkers[2], T_INVEST_LIVE_ACCOUNT_ID: privateMarkers[3],
    T_INVEST_EXECUTION_MODE: 'sandbox', NODE_TLS_REJECT_UNAUTHORIZED: '0' },
  state: { accountId: privateMarkers[3] }, private: privateMarkers[1] };
  fs.writeFileSync(source, JSON.stringify(payload), { mode: 0o600 });
  return { directory, source, output, payload };
}
function invoke(source, output, args = ['--source', source, '--output', output]) {
  const result = spawnSync(process.execPath, [helper, ...args], { encoding: 'utf8', env: {} });
  assert.equal(result.stderr, '');
  for (const marker of [...privateMarkers, 'synthetic-read-token', source, output]) assert.ok(!result.stdout.includes(marker));
  const report = JSON.parse(result.stdout);
  assert.equal(report.brokerRequests, 0);
  assert.equal(report.brokerWrites, false);
  return { ...result, report };
}
afterEach(() => {
  mock.restoreAll();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

test('capsule contains ONLY the original read token, discards every other field, source unchanged', () => {
  const f = fixture(), before = fs.readFileSync(f.source);
  assert.equal(prepareLocalReadCapsule(f).result, 'prepared');
  assert.deepEqual(JSON.parse(fs.readFileSync(f.output, 'utf8')), { env: { T_INVEST_TOKEN: 'synthetic-read-token' } });
  assert.deepEqual(fs.readFileSync(f.source), before);
  assert.equal(fs.statSync(f.output).mode & 0o7777, 0o600);
  assert.equal(fs.statSync(f.output).uid, process.getuid());
  assert.equal(fs.statSync(f.directory).mode & 0o7777, 0o700);
  for (const marker of privateMarkers) assert.ok(!fs.readFileSync(f.output, 'utf8').includes(marker));
});

test('CLI success only prints safe fixed report and supports flags in either order', () => {
  const f = fixture();
  const result = invoke(f.source, f.output, ['--output', f.output, '--source', f.source]);
  assert.equal(result.status, 0);
  assert.deepEqual(result.report, { result: 'prepared', brokerRequests: 0, brokerWrites: false });
});

test('existing output is never overwritten or chmodded', () => {
  const f = fixture();
  fs.writeFileSync(f.output, 'original-private-output', { mode: 0o644 });
  const result = invoke(f.source, f.output);
  assert.equal(result.status, 1);
  assert.equal(result.report.reason, 'output-exists');
  assert.equal(fs.readFileSync(f.output, 'utf8'), 'original-private-output');
  assert.equal(fs.statSync(f.output).mode & 0o7777, 0o644);
});

test('source equal to output is refused without altering source', () => {
  const f = fixture(), before = fs.readFileSync(f.source);
  assert.equal(prepareLocalReadCapsule({ source: f.source, output: f.source }).reason, 'output-exists');
  assert.deepEqual(fs.readFileSync(f.source), before);
});

test('source and output symlinks are refused without following or changing targets', () => {
  const f = fixture(), link = join(f.directory, 'link.json');
  fs.symlinkSync(f.source, link);
  assert.equal(prepareLocalReadCapsule({ source: link, output: f.output }).reason, 'source-not-private');
  fs.symlinkSync(f.source, f.output);
  assert.equal(prepareLocalReadCapsule(f).reason, 'output-exists');
  assert.ok(fs.lstatSync(f.output).isSymbolicLink());
});

test('symlink in source or output ancestry is refused', () => {
  const f = fixture(), parent = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'local-capsule-link-test-'));
  directories.push(parent);
  fs.chmodSync(parent, 0o700);
  const alias = join(parent, 'private-alias');
  fs.symlinkSync(f.directory, alias);
  assert.equal(prepareLocalReadCapsule({ source: join(alias, 'snapshot.json'), output: f.output }).reason, 'parent-path-unsafe');
  assert.equal(prepareLocalReadCapsule({ source: f.source, output: join(alias, 'new.json') }).reason, 'parent-path-unsafe');
  assert.ok(!fs.existsSync(join(f.directory, 'new.json')));
});

test('source must be a private regular 0600 file', () => {
  for (const mode of [0o644, 0o640, 0o400, 0o1600]) {
    const f = fixture();
    fs.chmodSync(f.source, mode);
    assert.equal(prepareLocalReadCapsule(f).reason, 'source-not-private');
    assert.ok(!fs.existsSync(f.output));
  }
  const f = fixture();
  // Keep the immediate parent private on both macOS and Linux. Passing the
  // fixture root itself makes this case depend on the host temp parent mode.
  const directorySource = join(f.directory, 'source-directory');
  fs.mkdirSync(directorySource, { mode: 0o700 });
  assert.equal(prepareLocalReadCapsule({ source: directorySource, output: f.output }).reason, 'source-not-private');
  assert.ok(fs.lstatSync(directorySource).isDirectory());
  assert.ok(!fs.existsSync(f.output));
});

test('source or output immediate parent must already be private 0700', () => {
  const f = fixture();
  fs.chmodSync(f.directory, 0o755);
  assert.equal(prepareLocalReadCapsule(f).reason, 'parent-not-private');
  assert.equal(fs.statSync(f.directory).mode & 0o7777, 0o755);
  fs.chmodSync(f.directory, 0o700);
  const other = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), 'local-capsule-open-parent-'));
  directories.push(other);
  fs.chmodSync(other, 0o755);
  assert.equal(prepareLocalReadCapsule({ source: f.source, output: join(other, 'out.json') }).reason, 'parent-not-private');
  assert.ok(!fs.existsSync(join(other, 'out.json')));
});

test('source owned by a different uid is rejected', () => {
  const f = fixture(), original = fs.fstatSync;
  mock.method(fs, 'fstatSync', (descriptor, options) => {
    const value = original(descriptor, options);
    if (value.isFile()) Object.defineProperty(value, 'uid', { value: BigInt(process.getuid() + 1) });
    return value;
  });
  assert.equal(prepareLocalReadCapsule(f).reason, 'source-not-private');
  assert.ok(!fs.existsSync(f.output));
});

test('source size is bounded at 64 KiB and no partial output is created', () => {
  const f = fixture();
  fs.writeFileSync(f.source, 'private-marker'.repeat(6000));
  const result = invoke(f.source, f.output);
  assert.equal(result.report.reason, 'source-too-large');
  assert.ok(!fs.existsSync(f.output));
});

test('bad JSON, invalid UTF-8 and non-object source/env never echo private contents', () => {
  for (const value of ['{"private":"live-private-marker"', '["live-private-marker"]', 'null',
    JSON.stringify({ env: [] }), JSON.stringify({ env: null }), JSON.stringify({ env: 'live-private-marker' })]) {
    const f = fixture();
    fs.writeFileSync(f.source, value);
    const result = invoke(f.source, f.output);
    assert.equal(result.status, 1);
    assert.ok(['source-json-invalid', 'source-shape-invalid'].includes(result.report.reason));
    assert.ok(!fs.existsSync(f.output));
  }
  const f = fixture();
  fs.writeFileSync(f.source, Buffer.from([0xff, 0xfe]));
  assert.equal(prepareLocalReadCapsule(f).reason, 'source-json-invalid');
});

test('missing/empty/non-string read token cannot fall back to live or sandbox token', () => {
  for (const token of [undefined, '', ' \n\t ', 123, {}, null]) {
    const f = fixture();
    f.payload.env.T_INVEST_TOKEN = token;
    fs.writeFileSync(f.source, JSON.stringify(f.payload));
    const result = invoke(f.source, f.output);
    assert.equal(result.report.reason, 'read-token-missing');
    assert.ok(!fs.existsSync(f.output));
  }
});

test('non-canonical, relative and invalid CLI paths are refused with fixed output', () => {
  const f = fixture();
  for (const args of [[], ['--source', f.source], ['--source', f.source, '--source', f.source],
    ['--private-live-marker', f.source, '--output', f.output]]) {
    assert.equal(invoke(f.source, f.output, args).report.reason, 'invalid-arguments');
  }
  for (const source of ['relative-private-marker.json', `${dirname(f.source)}/../private-marker.json`, '']) {
    assert.equal(prepareLocalReadCapsule({ source, output: f.output }).reason, 'invalid-path');
  }
});

test('new output stays exactly 0600 even with restrictive umask', () => {
  const f = fixture(), previous = process.umask(0o777);
  try {
    assert.equal(prepareLocalReadCapsule(f).result, 'prepared');
    assert.equal(fs.statSync(f.output).mode & 0o7777, 0o600);
  } finally { process.umask(previous); }
});

test('failed write removes only the newly created incomplete file and never echoes raw error', () => {
  const f = fixture();
  mock.method(fs, 'writeFileSync', () => { throw new Error('live-private-marker account-private-marker'); });
  const report = prepareLocalReadCapsule(f);
  assert.equal(report.reason, 'output-unavailable');
  assert.ok(!JSON.stringify(report).includes('private-marker'));
  assert.ok(!fs.existsSync(f.output));
  assert.ok(fs.existsSync(f.source));
});
