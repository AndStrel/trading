import fs from 'node:fs';
import { dirname, isAbsolute, normalize, parse, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_BYTES = 64 * 1024;
const PRIVATE_FILE_MODE = 0o600n;
const PRIVATE_DIRECTORY_MODE = 0o700n;
const MODE_MASK = 0o7777n;

class Refused extends Error {
  constructor(code) { super(code); this.code = code; }
}
function require(value, code) { if (!value) throw new Refused(code); }
function sameIdentity(left, right) { return left.dev === right.dev && left.ino === right.ino; }
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safePath(value) {
  require(typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0')
    && isAbsolute(value) && normalize(value) === value, 'invalid-path');
  return value;
}

function privateParents(filePath, uid, retained) {
  const chain = [];
  let directory = dirname(filePath);
  for (;;) {
    chain.unshift(directory);
    if (directory === parse(directory).root) break;
    directory = dirname(directory);
  }
  for (const path of chain) {
    let descriptor;
    try {
      const before = fs.lstatSync(path, { bigint: true });
      require(before.isDirectory() && !before.isSymbolicLink(), 'parent-path-unsafe');
      descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const opened = fs.fstatSync(descriptor, { bigint: true });
      require(opened.isDirectory() && sameIdentity(before, opened), 'parent-path-unsafe');
      if (path === dirname(filePath)) {
        require(opened.uid === uid && (opened.mode & MODE_MASK) === PRIVATE_DIRECTORY_MODE, 'parent-not-private');
      }
      retained.push({ path, descriptor, info: opened, private: path === dirname(filePath) });
      descriptor = undefined;
    } catch (error) {
      if (error instanceof Refused) throw error;
      throw new Refused('parent-path-unsafe');
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    }
  }
}

function verifyParents(retained, uid) {
  for (const item of retained) {
    const current = fs.lstatSync(item.path, { bigint: true });
    require(current.isDirectory() && !current.isSymbolicLink() && sameIdentity(current, item.info), 'parent-path-changed');
    if (item.private) require(current.uid === uid && (current.mode & MODE_MASK) === PRIVATE_DIRECTORY_MODE, 'parent-not-private');
  }
}

function readSource(path, uid, retained) {
  privateParents(path, uid, retained);
  let descriptor;
  try {
    const before = fs.lstatSync(path, { bigint: true });
    require(before.isFile() && !before.isSymbolicLink(), 'source-not-private');
    descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const opened = fs.fstatSync(descriptor, { bigint: true });
    require(opened.isFile() && sameIdentity(before, opened) && opened.uid === uid
      && (opened.mode & MODE_MASK) === PRIVATE_FILE_MODE, 'source-not-private');
    require(opened.size <= BigInt(MAX_BYTES), 'source-too-large');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = fs.readSync(descriptor, buffer, length, buffer.length - length, length);
      if (read === 0) break;
      length += read;
    }
    require(length <= MAX_BYTES, 'source-too-large');
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(path, { bigint: true });
    require(!current.isSymbolicLink() && sameIdentity(current, opened) && sameIdentity(after, opened)
      && after.size === opened.size && after.mtimeNs === opened.mtimeNs && after.ctimeNs === opened.ctimeNs,
    'source-changed');
    verifyParents(retained, uid);
    let payload;
    try { payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length))); }
    catch { throw new Refused('source-json-invalid'); }
    require(plainObject(payload) && plainObject(payload.env), 'source-shape-invalid');
    const token = payload.env.T_INVEST_TOKEN;
    require(typeof token === 'string' && token.trim().length > 0, 'read-token-missing');
    return token;
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused('source-unavailable');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function createOutput(path, token, uid, retained) {
  privateParents(path, uid, retained);
  verifyParents(retained, uid);
  let descriptor;
  let created;
  let complete = false;
  try {
    try {
      descriptor = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    } catch (error) {
      throw new Refused(error?.code === 'EEXIST' ? 'output-exists' : 'output-unavailable');
    }
    created = fs.fstatSync(descriptor, { bigint: true });
    require(created.isFile() && created.uid === uid && created.nlink === 1n, 'output-not-private');
    fs.fchmodSync(descriptor, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify({ env: { T_INVEST_TOKEN: token } })}\n`, 'utf8');
    fs.fsyncSync(descriptor);
    const info = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(path, { bigint: true });
    require(info.isFile() && info.uid === uid && info.nlink === 1n && (info.mode & MODE_MASK) === PRIVATE_FILE_MODE
      && !current.isSymbolicLink() && sameIdentity(current, info), 'output-not-private');
    verifyParents(retained, uid);
    complete = true;
  } catch (error) {
    if (error instanceof Refused) throw error;
    throw new Refused('output-unavailable');
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    // Remove only this invocation's incomplete new file, never an existing/replaced path.
    if (created && !complete) {
      try {
        const current = fs.lstatSync(path, { bigint: true });
        if (current.isFile() && !current.isSymbolicLink() && sameIdentity(current, created)) fs.unlinkSync(path);
      } catch { /* Leave an uncertain private artifact untouched. */ }
    }
  }
}

/** Host-only private projection. No environment load, Docker, SSH or broker client. */
export function prepareLocalReadCapsule({ source, output } = {}) {
  const retained = [];
  try {
    require(typeof process.getuid === 'function' && Number.isInteger(fs.constants.O_NOFOLLOW)
      && Number.isInteger(fs.constants.O_DIRECTORY), 'unsupported-platform');
    const uid = BigInt(process.getuid());
    const token = readSource(safePath(source), uid, retained);
    createOutput(safePath(output), token, uid, retained);
    return { result: 'prepared', brokerRequests: 0, brokerWrites: false };
  } catch (error) {
    return { result: 'refused', reason: error instanceof Refused ? error.code : 'capsule-preparation-failed',
      brokerRequests: 0, brokerWrites: false };
  } finally {
    for (const item of retained) { try { fs.closeSync(item.descriptor); } catch {} }
  }
}

export function main(args = process.argv.slice(2)) {
  let report;
  try {
    require(args.length === 4, 'invalid-arguments');
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      const key = args[index] === '--source' ? 'source' : args[index] === '--output' ? 'output' : null;
      require(key && !Object.hasOwn(options, key) && typeof args[index + 1] === 'string', 'invalid-arguments');
      options[key] = args[index + 1];
    }
    require(options.source && options.output, 'invalid-arguments');
    report = prepareLocalReadCapsule(options);
  } catch {
    report = { result: 'refused', reason: 'invalid-arguments', brokerRequests: 0, brokerWrites: false };
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return report.result === 'prepared' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) process.exitCode = main();
