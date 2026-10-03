import { spawn } from 'node:child_process';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, mkdtemp, open, rmdir, unlink, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export type BoundedSandboxCurlInput = {
  url: string; token: string; body: string; timeoutMs: number; maxBytes: number;
};
export type BoundedSandboxCurlPost = (input: BoundedSandboxCurlInput) => Promise<{ status: number; body: string }>;

const endpoint = 'https://sandbox-invest-public-api.tbank.ru/rest/'
  + 'tinkoff.public.invest.api.contract.v1.SandboxService/GetSandboxOperationsByCursor';
const statusPrefix = '\n__ANDSTREL_SANDBOX_HTTP_STATUS__:';
const statusBytes = Buffer.byteLength(statusPrefix) + 3;
const maximumResponseBytes = 1_048_576;
const maximumRequestBytes = 8192;
const maximumStderrBytes = 1024;
const failureMessage = 'Bounded sandbox read transport failed';

function refused(): Error { return new Error(failureMessage); }
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function validate(input: BoundedSandboxCurlInput): void {
  if (typeof process.getuid !== 'function' || !Number.isInteger(constants.O_NOFOLLOW) || !Number.isInteger(constants.O_DIRECTORY)
    || !input || input.url !== endpoint || typeof input.token !== 'string' || !input.token
    || /[\u0000-\u0020\u007f]/.test(input.token) || Buffer.byteLength(input.token) > maximumRequestBytes
    || typeof input.body !== 'string' || Buffer.byteLength(input.body) > maximumRequestBytes
    || !Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30_000
    || !Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1 || input.maxBytes > maximumResponseBytes) throw refused();
  try {
    const body: unknown = JSON.parse(input.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw refused();
  } catch { throw refused(); }
}

function requireTime(signal: AbortSignal, deadline: number): number {
  const remaining = Math.floor(deadline - performance.now());
  if (signal.aborted || remaining < 1) throw refused();
  return remaining;
}

function curlOnce(input: BoundedSandboxCurlInput, headersPath: string, signal: AbortSignal,
  deadline: number): Promise<{ status: number; body: string }> {
  const remaining = requireTime(signal, deadline);
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    let settled = false;
    let length = 0;
    const chunks: Buffer[] = [];
    // Retain at most 1 KiB for drainage bookkeeping, never return or render it.
    let stderr = Buffer.alloc(0);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => { try { child?.kill('SIGKILL'); } catch {} };
    const finish = (result?: { status: number; body: string }) => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      chunks.length = 0;
      stderr = Buffer.alloc(0);
      if (result) resolve(result); else { stop(); reject(refused()); }
    };
    const abort = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    try {
      // No inherited proxy/credential/loader environment and no user curlrc.
      // The container image supplies /usr/bin/curl and its verified system CA.
      child = spawn('/usr/bin/curl', [
        '--disable', '--silent', '--show-error', '--ipv4', '--request', 'POST',
        '--header', `@${headersPath}`, '--proto', '=https', '--max-redirs', '0', '--retry', '0',
        '--connect-timeout', String(Math.min(10_000, remaining) / 1000),
        '--max-time', String(remaining / 1000), '--max-filesize', String(input.maxBytes),
        '--data-binary', '@-', '--write-out', `${statusPrefix}%{http_code}`, input.url,
      ], { stdio: ['pipe', 'pipe', 'pipe'], env: {}, windowsHide: true });
      child.once('error', abort);
      child.stdout?.on('error', abort);
      child.stderr?.on('error', abort);
      child.stdin?.on('error', abort);
      child.stdout?.on('data', (raw: Buffer | string) => {
        if (settled) return;
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        if (length + chunk.length > input.maxBytes + statusBytes) { finish(); return; }
        length += chunk.length;
        chunks.push(chunk);
      });
      child.stderr?.on('data', (raw: Buffer | string) => {
        if (settled || stderr.length >= maximumStderrBytes) return;
        const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        stderr = Buffer.concat([stderr, chunk.subarray(0, maximumStderrBytes - stderr.length)]);
      });
      child.once('close', (code: number | null) => {
        if (settled) return;
        try {
          if (code !== 0 || signal.aborted || performance.now() >= deadline) throw refused();
          const bytes = Buffer.concat(chunks, length);
          const markerAt = bytes.lastIndexOf(statusPrefix);
          if (markerAt < 0 || markerAt > input.maxBytes || bytes.length - markerAt !== statusBytes) throw refused();
          const statusText = bytes.subarray(markerAt + Buffer.byteLength(statusPrefix)).toString('latin1');
          if (!/^\d{3}$/.test(statusText)) throw refused();
          const status = Number(statusText);
          if (status < 100 || status > 599 || (status >= 300 && status < 400)) throw refused();
          const body = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, markerAt));
          finish({ status, body });
        } catch { finish(); }
      });
      timer = setTimeout(abort, requireTime(signal, deadline));
      if (!child.stdin || !child.stdout || !child.stderr) throw refused();
      child.stdin.end(input.body);
    } catch { finish(); }
  });
}

/** One sandbox cursor READ only. Secrets and arbitrary subprocess errors never leave this module. */
export const postBoundedSandboxCurl: BoundedSandboxCurlPost = async input => {
  validate(input); // Invalid requests must not create a private file or spawn anything.
  const started = performance.now();
  const deadline = started + input.timeoutMs;
  const operationDeadline = deadline - Math.min(100, input.timeoutMs / 10);
  const uid = BigInt(process.getuid!());
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(refused()); }, input.timeoutMs);
  });
  const work = async () => {
    let directory: string | undefined;
    let directoryIdentity: BigIntStats | undefined;
    let directoryFile: FileHandle | undefined;
    let headersPath: string | undefined;
    let headersCreated = false;
    let headersIdentity: BigIntStats | undefined;
    let file: FileHandle | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), 'andstrel-sandbox-read-'));
      const createdDirectory = await lstat(directory, { bigint: true });
      if (!createdDirectory.isDirectory() || createdDirectory.isSymbolicLink() || createdDirectory.uid !== uid) throw refused();
      directoryIdentity = createdDirectory;
      requireTime(controller.signal, operationDeadline);
      directoryFile = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const openedDirectory = await directoryFile.stat({ bigint: true });
      if (!openedDirectory.isDirectory() || openedDirectory.uid !== uid || !sameIdentity(createdDirectory, openedDirectory)) throw refused();
      await directoryFile.chmod(0o700);
      requireTime(controller.signal, operationDeadline);
      headersPath = join(directory, 'headers');
      file = await open(headersPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      headersCreated = true;
      requireTime(controller.signal, operationDeadline);
      await file.chmod(0o600);
      requireTime(controller.signal, operationDeadline);
      const info = await file.stat({ bigint: true });
      if (info.isFile()) headersIdentity = info;
      if (!info.isFile() || info.uid !== uid || info.nlink !== 1n || (info.mode & 0o7777n) !== 0o600n) throw refused();
      requireTime(controller.signal, operationDeadline);
      await file.writeFile(`Authorization: Bearer ${input.token}\nContent-Type: application/json\nAccept: application/json\n`,
        { encoding: 'utf8', signal: controller.signal });
      await file.close();
      file = undefined;
      return await curlOnce(input, headersPath, controller.signal, operationDeadline);
    } catch { throw refused(); }
    finally {
      controller.abort();
      let cleanupFailed = false;
      try { await file?.close(); } catch { cleanupFailed = true; }
      try { await directoryFile?.close(); } catch { cleanupFailed = true; }
      // Delete only the file and directory created by this invocation, never recursively.
      // Late setup completion still reaches this cleanup even if the outer deadline won.
      if (directory) {
        try {
          const currentDirectory = await lstat(directory, { bigint: true });
          if (!directoryIdentity || !currentDirectory.isDirectory() || currentDirectory.isSymbolicLink()
            || currentDirectory.uid !== uid || !sameIdentity(directoryIdentity, currentDirectory)) throw refused();
          if (headersCreated) {
            if (!headersPath || !headersIdentity) throw refused();
            const currentHeaders = await lstat(headersPath, { bigint: true });
            if (!currentHeaders.isFile() || currentHeaders.isSymbolicLink() || currentHeaders.uid !== uid
              || !sameIdentity(headersIdentity, currentHeaders)) throw refused();
            await unlink(headersPath);
          }
          // Recheck after unlink as well: a replacement directory must never be removed.
          const directoryBeforeRemoval = await lstat(directory, { bigint: true });
          if (!directoryBeforeRemoval.isDirectory() || directoryBeforeRemoval.isSymbolicLink()
            || directoryBeforeRemoval.uid !== uid || !sameIdentity(directoryIdentity, directoryBeforeRemoval)) throw refused();
          await rmdir(directory);
        } catch { cleanupFailed = true; }
      }
      if (cleanupFailed) throw refused();
    }
  };
  try {
    const result = await Promise.race([work(), timeout]);
    if (performance.now() >= deadline) throw refused();
    return result;
  }
  catch { throw refused(); }
  finally { controller.abort(); if (timer !== undefined) clearTimeout(timer); }
};
