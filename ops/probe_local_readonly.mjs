import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const capsulePath = '/run/private/read-snapshot.json';
const maxCapsuleBytes = 65_536;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function emptyReport() {
  return {
    scope: 'local-read-only-broker', result: 'not-ready', reason: null,
    accountsRead: false, userInfoRead: false, accountCount: null,
    namedAccounts: { daily: { found: false, open: false, ordinary: false },
      weekly: { found: false, open: false, ordinary: false } },
    tariff: null, liveCredentialVerified: false, liveSubmissionAllowed: false, brokerWrites: false,
  };
}

// Only metadata reads. Never returns account names, IDs, money, or raw broker errors.
export async function probeReadOnlyBroker(client) {
  const report = emptyReport();
  try {
    const [accountPayload, infoPayload] = await Promise.all([client.getAccounts(), client.getUserInfo()]);
    if (!record(accountPayload) || !Array.isArray(accountPayload.accounts)
      || accountPayload.accounts.length > 100 || !record(infoPayload)
      || typeof infoPayload.tariff !== 'string' || !infoPayload.tariff.trim() || infoPayload.tariff.length > 128) {
      report.reason = 'broker-payload-invalid';
      return report;
    }
    const accounts = accountPayload.accounts;
    if (!accounts.every(account => record(account) && typeof account.id === 'string'
      && account.id.length > 0 && account.id.length <= 256 && typeof account.name === 'string'
      && account.name.length <= 256 && typeof account.status === 'string'
      && typeof account.type === 'string') || new Set(accounts.map(account => account.id)).size !== accounts.length) {
      report.reason = 'broker-payload-invalid';
      return report;
    }
    report.accountsRead = true;
    report.userInfoRead = true;
    report.accountCount = accounts.length;
    const tariff = infoPayload.tariff.toLowerCase();
    report.tariff = tariff === 'investor' || tariff === 'trader' ? tariff : 'other';
    for (const [profile, name] of [['daily', 'дневной'], ['weekly', 'недельный']]) {
      const matches = accounts.filter(account => account.name.trim().toLowerCase() === name);
      if (matches.length > 1) { report.reason = 'named-account-ambiguous'; return report; }
      if (matches.length === 1) {
        const account = matches[0];
        report.namedAccounts[profile] = { found: true,
          open: account.status === 'ACCOUNT_STATUS_OPEN', ordinary: account.type === 'ACCOUNT_TYPE_TINKOFF' };
      }
    }
    // These names come from the user. They do not select or reconfigure any execution account.
    if (!Object.values(report.namedAccounts).every(account => account.found && account.open && account.ordinary)) {
      report.reason = 'named-accounts-unconfirmed';
      return report;
    }
    report.result = 'read-access-confirmed';
    return report;
  } catch {
    report.reason = 'broker-read-unconfirmed';
    return report;
  }
}

function readCredential() {
  const fd = openSync(capsulePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = fstatSync(fd);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o777) !== 0o600
      || info.size <= 0 || info.size > maxCapsuleBytes) throw new Error();
    const bytes = readFileSync(fd);
    if (bytes.length > maxCapsuleBytes) throw new Error();
    const capsule = JSON.parse(bytes.toString('utf8'));
    if (!record(capsule) || Object.keys(capsule).length !== 1 || !record(capsule.env)
      || Object.keys(capsule.env).length !== 1 || typeof capsule.env.T_INVEST_TOKEN !== 'string'
      || !capsule.env.T_INVEST_TOKEN.trim()) throw new Error();
    return capsule.env.T_INVEST_TOKEN;
  } finally { closeSync(fd); }
}

export async function main(args = process.argv.slice(2)) {
  let report;
  try {
    if (args.length) throw new Error();
    const token = readCredential();
    // The pinned application image supplies this tested, allowlisted read-only client.
    const { LivePreflightClient, liveProductionEndpoint } = await import('/app/dist/execution/live-preflight-client.js');
    report = await probeReadOnlyBroker(new LivePreflightClient(token, liveProductionEndpoint, 'fetch'));
  } catch {
    report = emptyReport();
    report.reason = 'local-read-configuration-invalid';
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  return report.result === 'read-access-confirmed' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
