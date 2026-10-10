import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { constants } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  spawn: vi.fn(), mkdtemp: vi.fn(), lstat: vi.fn(), open: vi.fn(), unlink: vi.fn(), rmdir: vi.fn(),
  fileChmod: vi.fn(), stat: vi.fn(), writeFile: vi.fn(), close: vi.fn(),
  directoryChmod: vi.fn(), directoryStat: vi.fn(), directoryClose: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: mocked.spawn }));
vi.mock('node:fs/promises', () => ({
  mkdtemp: mocked.mkdtemp, lstat: mocked.lstat, open: mocked.open,
  unlink: mocked.unlink, rmdir: mocked.rmdir,
}));
vi.mock('node:os', () => ({ tmpdir: () => '/synthetic-private-temp' }));

import { postBoundedSandboxCurl, type BoundedSandboxCurlInput } from './bounded-curl.js';

const endpoint = 'https://sandbox-invest-public-api.tbank.ru/rest/'
  + 'tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOperationsByCursor';
const marker = '\n__ANDSTREL_SANDBOX_HTTP_STATUS__:';
const privateMarker = 'synthetic-private-token-marker';
const directory = '/synthetic-private-temp/andstrel-sandbox-read-fake';
const directoryInfo = () => ({ dev: 1n, ino: 10n, uid: BigInt(process.getuid!()), mode: 0o700n,
  isDirectory: () => true, isSymbolicLink: () => false });
const headerInfo = () => ({ dev: 1n, ino: 11n, uid: BigInt(process.getuid!()), nlink: 1n, mode: 0o600n,
  isFile: () => true, isSymbolicLink: () => false });
const input = (changes: Partial<BoundedSandboxCurlInput> = {}): BoundedSandboxCurlInput => ({
  url: endpoint, token: privateMarker, body: '{"accountId":"synthetic-private-account"}',
  timeoutMs: 1000, maxBytes: 1_048_576, ...changes,
});

class FakeChild extends EventEmitter {
  stdin = new PassThrough(); stdout = new PassThrough(); stderr = new PassThrough(); kill = vi.fn(() => true);
}

function response(body = '{"items":[]}', status = '200', code: number | null = 0): FakeChild {
  const child = new FakeChild();
  mocked.spawn.mockImplementationOnce(() => {
    queueMicrotask(() => { child.stdout.write(body + marker + status); child.emit('close', code); });
    return child;
  });
  return child;
}

async function rejected(request: BoundedSandboxCurlInput = input()) {
  const error = await postBoundedSandboxCurl(request).then(() => null, (value: unknown) => value);
  expect(error).toBeInstanceOf(Error);
  expect(String(error)).toBe('Error: Bounded sandbox read transport failed');
  expect(String(error)).not.toContain(privateMarker);
  expect(String(error)).not.toContain('synthetic-private-account');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocked.mkdtemp.mockResolvedValue(directory);
  mocked.lstat.mockImplementation(async path => path === directory ? directoryInfo() : headerInfo());
  mocked.open.mockImplementation(async path => path === directory
    ? { chmod: mocked.directoryChmod, stat: mocked.directoryStat, close: mocked.directoryClose }
    : { chmod: mocked.fileChmod, stat: mocked.stat, writeFile: mocked.writeFile, close: mocked.close });
  mocked.stat.mockResolvedValue(headerInfo()); mocked.directoryStat.mockResolvedValue(directoryInfo());
  mocked.directoryChmod.mockResolvedValue(undefined); mocked.directoryClose.mockResolvedValue(undefined);
  mocked.fileChmod.mockResolvedValue(undefined); mocked.writeFile.mockResolvedValue(undefined);
  mocked.close.mockResolvedValue(undefined); mocked.unlink.mockResolvedValue(undefined); mocked.rmdir.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('bounded one-shot sandbox cursor system curl', () => {
  it('uses exactly one private 0600 header file, no token/body argv or inherited environment', async () => {
    const child = response();
    const body: Buffer[] = []; child.stdin.on('data', chunk => body.push(Buffer.from(chunk)));
    await expect(postBoundedSandboxCurl(input())).resolves.toEqual({ status: 200, body: '{"items":[]}' });
    expect(mocked.spawn).toHaveBeenCalledOnce();
    const [binary, args, options] = mocked.spawn.mock.calls[0]!;
    expect(binary).toBe('/usr/bin/curl');
    expect(args[0]).toBe('--disable');
    expect(args).toEqual(expect.arrayContaining(['--proto', '=https', '--max-redirs', '0', '--retry', '0', '--max-filesize', '1048576']));
    expect(args).not.toEqual(expect.arrayContaining(['--location', '-L', '--insecure', '-k']));
    expect(JSON.stringify(args)).not.toContain(privateMarker);
    expect(JSON.stringify(args)).not.toContain('synthetic-private-account');
    expect(options).toMatchObject({ stdio: ['pipe', 'pipe', 'pipe'], env: {} });
    expect(Buffer.concat(body).toString()).toBe(input().body);
    expect(mocked.directoryChmod).toHaveBeenCalledWith(0o700);
    expect(mocked.open).toHaveBeenCalledWith(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    expect(mocked.open).toHaveBeenCalledWith(directory + '/headers',
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    expect(mocked.fileChmod).toHaveBeenCalledWith(0o600);
    expect(mocked.writeFile).toHaveBeenCalledWith(`Authorization: Bearer ${privateMarker}\nContent-Type: application/json\nAccept: application/json\n`,
      expect.objectContaining({ encoding: 'utf8', signal: expect.any(AbortSignal) }));
    expect(mocked.unlink).toHaveBeenCalledWith(directory + '/headers');
    expect(mocked.rmdir).toHaveBeenCalledWith(directory);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('rejects noncanonical/production/arbitrary/write endpoints before tempfile or spawn', async () => {
    for (const url of [endpoint.replace('https:', 'http:'), endpoint.replace('sandbox-invest-', 'invest-'),
      endpoint.replace('sandbox-invest-public-api.tbank.ru', 'example.test'), endpoint + '?token=' + privateMarker,
      endpoint + '#private', endpoint.replace('https://', `https://${privateMarker}@`),
      endpoint.replace('.ru/rest', '.ru:443/rest'), endpoint.replace('GetSandboxOperationsByCursor', 'PostSandboxOrder'),
      endpoint.replace('GetSandboxOperationsByCursor', 'SandboxPayIn'), ' ' + endpoint, endpoint + '\r\n']) {
      await rejected(input({ url }));
    }
    expect(mocked.mkdtemp).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it('rejects empty, injected or oversized tokens without filesystem/process effects', async () => {
    for (const token of ['', ' ', privateMarker + '\r\nOther: value', privateMarker + '\0',
      privateMarker + '\t', privateMarker + '\x7f', 'x'.repeat(8193)]) await rejected(input({ token }));
    expect(mocked.mkdtemp).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it('rejects bad request JSON, arrays/non-objects and UTF8 request size before tempfile', async () => {
    for (const body of ['', 'private-bad-json', '[]', 'null', '1', '"private"', JSON.stringify({ text: 'я'.repeat(4096) })]) {
      await rejected(input({ body }));
    }
    expect(mocked.mkdtemp).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it('rejects invalid response bounds and whole-call time bounds before tempfile', async () => {
    for (const maxBytes of [0, -1, 1.5, NaN, Infinity, 1_048_577]) await rejected(input({ maxBytes }));
    for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 30_001]) await rejected(input({ timeoutMs }));
    expect(mocked.mkdtemp).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
  });

  it('verifies the opened private regular header file before putting any token in it', async () => {
    for (const changes of [{ uid: BigInt(process.getuid!()) + 1n }, { mode: 0o644n }, { nlink: 2n }, { isFile: () => false }]) {
      mocked.stat.mockResolvedValueOnce({ ...headerInfo(), ...changes });
      await rejected();
    }
    expect(mocked.writeFile).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
    expect(mocked.unlink).toHaveBeenCalledTimes(3); expect(mocked.rmdir).toHaveBeenCalledTimes(3);
  });

  it('accepts exactly maxBytes body plus marker, counted in bytes not UTF16 characters', async () => {
    response('я');
    await expect(postBoundedSandboxCurl(input({ maxBytes: 2 }))).resolves.toEqual({ status: 200, body: 'я' });
    response('я'); await rejected(input({ maxBytes: 1 }));
  });

  it('kills immediately once streaming stdout exceeds body cap plus fixed marker overhead', async () => {
    const child = new FakeChild(); mocked.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => { child.stdout.emit('data', Buffer.alloc(64 + Buffer.byteLength(marker) + 4)); });
      return child;
    });
    await rejected(input({ maxBytes: 64 }));
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(mocked.spawn).toHaveBeenCalledOnce(); expect(mocked.unlink).toHaveBeenCalledOnce();
  });

  it('allows the hard 1MiB body ceiling and never allocates an oversized result', async () => {
    response('x'.repeat(1_048_576));
    expect((await postBoundedSandboxCurl(input())).body.length).toBe(1_048_576);
    const child = response('x'.repeat(1_048_577));
    await rejected(); expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('masks nonzero exit/large stderr/spawn errors and never retries or falls back', async () => {
    const child = new FakeChild(); mocked.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => { child.stderr.write(privateMarker.repeat(10_000)); child.emit('close', 60); }); return child;
    });
    await rejected(); expect(mocked.spawn).toHaveBeenCalledOnce();
    mocked.spawn.mockImplementationOnce(() => { throw new Error(privateMarker); });
    await rejected(); expect(mocked.spawn).toHaveBeenCalledTimes(2);
  });

  it('masks child/stdin/stdout/stderr errors and performs private cleanup', async () => {
    for (const source of ['child', 'stdin', 'stdout', 'stderr'] as const) {
      const child = new FakeChild(); mocked.spawn.mockImplementationOnce(() => {
        queueMicrotask(() => { (source === 'child' ? child : child[source]).emit('error', new Error(privateMarker)); }); return child;
      });
      await rejected(); expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    }
    expect(mocked.unlink).toHaveBeenCalledTimes(4); expect(mocked.rmdir).toHaveBeenCalledTimes(4);
  });

  it('rejects missing/malformed marker, invalid statuses, redirects and invalid UTF8', async () => {
    for (const status of ['', '20', '200\n', '000', '099', '600', 'abc', '302']) { response('{}', status); await rejected(); }
    const child = new FakeChild(); mocked.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => { child.stdout.write(Buffer.concat([Buffer.from([0xff]), Buffer.from(marker + '200')])); child.emit('close', 0); }); return child;
    }); await rejected();
    const missing = new FakeChild(); mocked.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => { missing.stdout.write('private-data-without-marker'); missing.emit('close', 0); }); return missing;
    }); await rejected();
    const highBitStatus = new FakeChild(); mocked.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => { highBitStatus.stdout.write(Buffer.concat([Buffer.from('{}' + marker), Buffer.from([0xb2, 0xb0, 0xb0])])); highBitStatus.emit('close', 0); }); return highBitStatus;
    }); await rejected();
  });

  it('preserves bounded non-redirect HTTP error response for private caller validation', async () => {
    response('{"error":"synthetic-private"}', '403');
    await expect(postBoundedSandboxCurl(input())).resolves.toEqual({ status: 403, body: '{"error":"synthetic-private"}' });
  });

  it('times out and kills an unresponsive process within the caller budget, with cleanup', async () => {
    const child = new FakeChild(); mocked.spawn.mockReturnValueOnce(child);
    const started = performance.now(); await rejected(input({ timeoutMs: 30 }));
    expect(performance.now() - started).toBeLessThan(250);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL'); expect(mocked.unlink).toHaveBeenCalledOnce();
    const args = mocked.spawn.mock.calls[0]![1] as string[];
    const maxTime = Number(args[args.indexOf('--max-time') + 1]); expect(maxTime).toBeGreaterThan(0); expect(maxTime).toBeLessThanOrEqual(0.03);
  });

  it('counts filesystem setup time and never spawns after the deadline; late setup cleans itself', async () => {
    mocked.mkdtemp.mockImplementationOnce(() => new Promise(resolve => setTimeout(() => resolve(directory), 35)));
    const started = performance.now(); await rejected(input({ timeoutMs: 10 }));
    expect(performance.now() - started).toBeLessThan(100);
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(mocked.open).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
    expect(mocked.rmdir).toHaveBeenCalledWith(directory);
  });

  it('bounds stalled cleanup by the same whole-call timer and never propagates private filesystem errors', async () => {
    response(); mocked.unlink.mockImplementationOnce(() => new Promise(() => {}));
    const started = performance.now(); await rejected(input({ timeoutMs: 20 }));
    expect(performance.now() - started).toBeLessThan(150);
    mocked.open.mockRejectedValueOnce(new Error(privateMarker)); await rejected();
    expect(mocked.rmdir).toHaveBeenCalledWith(directory);
  });

  it('fails closed on cleanup failure instead of returning a successful private response', async () => {
    response(); mocked.unlink.mockRejectedValueOnce(new Error(privateMarker)); await rejected();
    response(); mocked.rmdir.mockRejectedValueOnce(new Error(privateMarker)); await rejected();
    expect(mocked.spawn).toHaveBeenCalledTimes(2);
  });

  it('never unlinks an existing foreign header when exclusive creation fails with EEXIST', async () => {
    const foreignContents = 'synthetic-other-file-must-survive';
    const originalOpen = mocked.open.getMockImplementation()!;
    mocked.open.mockImplementation(async (...args) => {
      if (args[0] === directory + '/headers') throw Object.assign(new Error(foreignContents), { code: 'EEXIST' });
      return originalOpen(...args);
    });
    mocked.rmdir.mockRejectedValueOnce(Object.assign(new Error('nonempty'), { code: 'ENOTEMPTY' }));
    await rejected();
    expect(mocked.unlink).not.toHaveBeenCalled(); expect(mocked.writeFile).not.toHaveBeenCalled();
    expect(mocked.spawn).not.toHaveBeenCalled(); expect(foreignContents).toBe('synthetic-other-file-must-survive');
  });

  it('does not unlink a replaced header inode or symlink, even after a successful broker response', async () => {
    for (const changes of [{ ino: 99n }, { dev: 9n }, { isFile: () => false, isSymbolicLink: () => true }]) {
      mocked.unlink.mockClear(); mocked.rmdir.mockClear();
      mocked.lstat.mockImplementation(async path => path === directory ? directoryInfo() : { ...headerInfo(), ...changes });
      response(); await rejected();
      expect(mocked.unlink).not.toHaveBeenCalled(); expect(mocked.rmdir).not.toHaveBeenCalled();
    }
  });

  it('does not unlink headers or rmdir a replaced invocation directory or symlink', async () => {
    for (const changes of [{ ino: 99n }, { dev: 9n }, { isDirectory: () => false, isSymbolicLink: () => true }]) {
      mocked.spawn.mockClear(); mocked.unlink.mockClear(); mocked.rmdir.mockClear();
      mocked.lstat.mockImplementation(async path => path === directory
        ? { ...directoryInfo(), ...(mocked.spawn.mock.calls.length ? changes : {}) } : headerInfo());
      response(); await rejected();
      expect(mocked.unlink).not.toHaveBeenCalled(); expect(mocked.rmdir).not.toHaveBeenCalled();
    }
  });

  it('rechecks directory identity immediately before rmdir after removing only its own header', async () => {
    let replaced = false;
    mocked.lstat.mockImplementation(async path => path === directory
      ? { ...directoryInfo(), ino: replaced ? 99n : 10n } : headerInfo());
    mocked.unlink.mockImplementationOnce(async () => { replaced = true; });
    response(); await rejected();
    expect(mocked.unlink).toHaveBeenCalledWith(directory + '/headers'); expect(mocked.rmdir).not.toHaveBeenCalled();
  });

  it('refuses a replacement directory descriptor before chmod or writing the secret', async () => {
    mocked.directoryStat.mockResolvedValueOnce({ ...directoryInfo(), ino: 99n });
    await rejected();
    expect(mocked.directoryChmod).not.toHaveBeenCalled(); expect(mocked.writeFile).not.toHaveBeenCalled();
    expect(mocked.unlink).not.toHaveBeenCalled(); expect(mocked.spawn).not.toHaveBeenCalled();
  });
});
