import test from 'node:test';
import assert from 'node:assert/strict';
import { probeReadOnlyBroker } from './probe_local_readonly.mjs';

const account = (name, id) => ({ name, id, status: 'ACCOUNT_STATUS_OPEN', type: 'ACCOUNT_TYPE_TINKOFF' });
const payload = () => ({ accounts: [account(' Дневной ', 'private-daily-marker'), account('Недельный', 'private-weekly-marker')] });
const client = (accounts = payload(), info = { tariff: 'Investor' }) => ({
  getAccounts: async () => accounts, getUserInfo: async () => info,
});

test('only two metadata methods; no identifiers or names leave the report', async () => {
  const calls = [];
  const report = await probeReadOnlyBroker({
    getAccounts: async () => { calls.push('accounts'); return payload(); },
    getUserInfo: async () => { calls.push('info'); return { tariff: 'Investor' }; },
    postOrder: () => { throw new Error('order method must not be called'); },
  });
  assert.deepEqual(calls, ['accounts', 'info']);
  assert.equal(report.result, 'read-access-confirmed');
  assert.equal(report.accountCount, 2);
  assert.equal(report.tariff, 'investor');
  assert.equal(report.liveCredentialVerified, false);
  assert.equal(report.liveSubmissionAllowed, false);
  assert.equal(report.brokerWrites, false);
  assert.doesNotMatch(JSON.stringify(report), /private-|Дневной|Недельный/);
});

test('missing selected name is not inferred from other accounts', async () => {
  const report = await probeReadOnlyBroker(client({ accounts: [account('other', 'private-marker')] }));
  assert.equal(report.result, 'not-ready');
  assert.equal(report.reason, 'named-accounts-unconfirmed');
  assert.equal(report.accountsRead, true);
});

test('duplicate named selection is refused without choosing an account', async () => {
  const data = payload(); data.accounts.push(account('дневной', 'other-private-id'));
  assert.equal((await probeReadOnlyBroker(client(data))).reason, 'named-account-ambiguous');
});

test('duplicate private ID and malformed payloads are refused', async () => {
  const duplicated = payload(); duplicated.accounts[1].id = duplicated.accounts[0].id;
  for (const data of [null, [], {}, { accounts: null }, { accounts: [null] }, duplicated,
    { accounts: [{ ...account('дневной', 'marker'), id: '' }] }]) {
    const report = await probeReadOnlyBroker(client(data));
    assert.equal(report.reason, 'broker-payload-invalid');
    assert.equal(report.accountsRead, false);
  }
});

test('closed or non-ordinary named accounts do not pass', async () => {
  for (const field of ['status', 'type']) {
    const data = payload(); data.accounts[0][field] = 'unsupported';
    assert.equal((await probeReadOnlyBroker(client(data))).result, 'not-ready');
  }
});

test('unknown tariff is a safe enum, not an arbitrary broker string', async () => {
  const report = await probeReadOnlyBroker(client(payload(), { tariff: 'private-tariff-marker' }));
  assert.equal(report.tariff, 'other');
  assert.doesNotMatch(JSON.stringify(report), /private-/);
});

test('malformed GetInfo and oversized responses do not verify credentials', async () => {
  for (const info of [null, {}, { tariff: null }, { tariff: '' }, { tariff: ' ' }, { tariff: 'x'.repeat(129) }]) {
    assert.equal((await probeReadOnlyBroker(client(payload(), info))).reason, 'broker-payload-invalid');
  }
  assert.equal((await probeReadOnlyBroker(client({ accounts: Array(101).fill(account('marker', 'marker')) }))).reason,
    'broker-payload-invalid');
});

test('broker failures do not leak private exception text or imply readiness', async () => {
  for (const failing of ['getAccounts', 'getUserInfo']) {
    const fake = client(); fake[failing] = async () => { throw new Error('secret-private-token-marker'); };
    const report = await probeReadOnlyBroker(fake);
    assert.equal(report.result, 'not-ready');
    assert.equal(report.reason, 'broker-read-unconfirmed');
    assert.doesNotMatch(JSON.stringify(report), /secret|marker/);
  }
});
