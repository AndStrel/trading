import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { ScenarioJournal } from '../journal/scenario-journal.js';
import { MarketSourceController, marketSourcePreferenceKey,
  type MarketSourcePreferenceStore } from './market-source.js';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function memoryStore(initial: string | null = null) {
  let stored = initial;
  const getRuntimeState = vi.fn((_key: string) => stored);
  const setRuntimeState = vi.fn((_key: string, value: string) => { stored = value; });
  return { getRuntimeState, setRuntimeState, read: () => stored };
}

describe('market source selection',()=>{
 it('requires a configured source and recent successful proof',()=>{
  let now=0;const c=new MarketSourceController({server:fetch,computer:fetch},()=>now);
  expect(()=>c.select('computer')).toThrow();c.recordHealth('computer',true);c.select('computer');
  now=60001;expect(()=>c.select('computer')).toThrow();
  c.recordHealth('computer',false);expect(()=>c.select('computer')).toThrow();
  const missing=new MarketSourceController({server:fetch});missing.recordHealth('computer',true);
  expect(()=>missing.select('computer')).toThrow();
 });
 it('does not mix sources during overlapping scans and releases each lease only once',()=>{
  const c=new MarketSourceController({server:fetch,computer:fetch});c.recordHealth('computer',true);
  const a=c.acquireScan();const b=c.acquireScan();expect(()=>c.select('computer')).toThrow();
  a();a();expect(()=>c.select('computer')).toThrow();b();c.select('computer');
  expect(c.view()).toMatchObject({selected:'computer',busy:false});
 });
 it('routes to the selected source without fallback after disconnect',async()=>{
  const server=vi.fn<typeof fetch>();const computer=vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  const c=new MarketSourceController({server,computer});c.recordHealth('computer',true);c.select('computer');
  await expect(c.fetch('https://example.invalid')).rejects.toThrow('offline');
  expect(server).not.toHaveBeenCalled();expect(computer).toHaveBeenCalledOnce();
 });
});

describe('durable read-only market source preference', () => {
  it('retains the legacy default when storage is omitted or its key is missing', async () => {
    const server = vi.fn<typeof fetch>().mockResolvedValue(new Response('server'));
    const preferences = memoryStore();
    const legacy = new MarketSourceController({ server });
    const missing = new MarketSourceController({ server }, () => 0, preferences);
    expect(legacy.view().selected).toBe('server');
    expect(missing.view().selected).toBe('server');
    expect(preferences.getRuntimeState).toHaveBeenCalledExactlyOnceWith(marketSourcePreferenceKey);
    expect(preferences.setRuntimeState).not.toHaveBeenCalled();
    expect(missing.view().sources.every(source => !source.available && source.checkedAt === null)).toBe(true);
    await expect(missing.fetch('https://example.invalid')).resolves.toBeInstanceOf(Response);
    expect(server).toHaveBeenCalledOnce();
  });

  it('persists only an exact versioned source record and restores neither health, location nor a lease', () => {
    const preferences = memoryStore();
    const sources = { server: fetch, computer: fetch };
    const first = new MarketSourceController(sources, () => 1000, preferences);
    first.recordHealth('computer', true);
    first.recordLocation('computer', { countryCode: 'RU', checkedAt: new Date(1000).toISOString() });
    first.select('computer');
    expect(preferences.setRuntimeState).toHaveBeenCalledExactlyOnceWith(
      marketSourcePreferenceKey, '{"version":1,"selected":"computer"}',
    );
    const release = first.acquireScan();
    const restarted = new MarketSourceController(sources, () => 1000, preferences);
    expect(restarted.view()).toEqual({ selected: 'computer', busy: false, sources: [
      { id: 'server', configured: true, available: false, checkedAt: null, countryCode: null, locationCheckedAt: null },
      { id: 'computer', configured: true, available: false, checkedAt: null, countryCode: null, locationCheckedAt: null },
    ] });
    expect(() => restarted.select('computer')).toThrow('Market source availability is not freshly confirmed');
    expect(preferences.setRuntimeState).toHaveBeenCalledOnce();
    release();
  });

  it('can persist a fresh deliberate switch back to server and restore it', () => {
    const preferences = memoryStore('{"version":1,"selected":"computer"}');
    const controller = new MarketSourceController({ server: fetch, computer: fetch }, () => 0, preferences);
    controller.recordHealth('server', true);
    controller.select('server');
    expect(preferences.read()).toBe('{"version":1,"selected":"server"}');
    expect(new MarketSourceController({ server: fetch }, () => 0, preferences).view().selected).toBe('server');
  });

  it('survives a new controller and journal instance without storing unrelated state', () => {
    const directory = mkdtempSync(join(tmpdir(), 'andstrel-market-source-test-'));
    temporaryDirectories.push(directory);
    const journalPath = join(directory, 'private', 'journal.sqlite');
    const firstJournal = new ScenarioJournal(journalPath);
    firstJournal.setExecutionKilled(true);
    firstJournal.setRuntimeState('scanner.intraday.paused', 'true');
    const first = new MarketSourceController({ server: fetch, computer: fetch }, () => 0, firstJournal);
    first.recordHealth('computer', true);
    first.select('computer');
    const restartedJournal = new ScenarioJournal(journalPath);
    const restarted = new MarketSourceController({ server: fetch, computer: fetch }, () => 0, restartedJournal);
    expect(restarted.view().selected).toBe('computer');
    expect(restarted.view().sources.find(source => source.id === 'computer')?.available).toBe(false);
    expect(restartedJournal.getRuntimeState(marketSourcePreferenceKey)).toBe('{"version":1,"selected":"computer"}');
    expect(restartedJournal.isExecutionKilled()).toBe(true);
    expect(restartedJournal.getRuntimeState('scanner.intraday.paused')).toBe('true');
  });

  it('keeps a restored unconfigured computer selected and refuses fetch without using the server', async () => {
    const server = vi.fn<typeof fetch>();
    const preferences = memoryStore('{"version":1,"selected":"computer"}');
    const controller = new MarketSourceController({ server }, () => 0, preferences);
    expect(controller.view()).toMatchObject({ selected: 'computer', sources: [
      { id: 'server', configured: true, available: false },
      { id: 'computer', configured: false, available: false },
    ] });
    await expect(controller.fetch('https://example.invalid')).rejects.toThrow('Selected market source is not configured');
    controller.recordHealth('computer', true);
    expect(() => controller.select('computer')).toThrow('Market source availability is not freshly confirmed');
    expect(server).not.toHaveBeenCalled();
    expect(preferences.setRuntimeState).not.toHaveBeenCalled();
  });

  it('never falls back from a restored configured computer, even after a failed health probe', async () => {
    const server = vi.fn<typeof fetch>();
    const computer = vi.fn<typeof fetch>().mockRejectedValue(new Error('synthetic offline'));
    const controller = new MarketSourceController({ server, computer }, () => 0,
      memoryStore('{"version":1,"selected":"computer"}'));
    expect(controller.view().sources.find(source => source.id === 'computer')?.checkedAt).toBeNull();
    await expect(controller.fetch('https://example.invalid')).rejects.toThrow('synthetic offline');
    controller.recordHealth('computer', false);
    await expect(controller.fetch('https://example.invalid')).rejects.toThrow('synthetic offline');
    expect(controller.view().selected).toBe('computer');
    expect(server).not.toHaveBeenCalled();
    expect(computer).toHaveBeenCalledTimes(2);
  });

  it.each([
    '', 'private-synthetic-token', '{}', 'null', '[]', '"computer"',
    '{"version":1,"selected":"unknown-private-value"}',
    '{"version":2,"selected":"computer"}',
    '{"version":"1","selected":"computer"}',
    '{"version":1,"selected":"computer","token":"private-synthetic-token"}',
    '{"version":1,"selected":"server","selected":"computer"}',
    '{"version":1,"selected":"computer","available":true}',
    '{"version":1,"selected":"computer","accountId":"private-synthetic-account"}',
    '{"selected":"computer","version":1}',
    ' {"version":1,"selected":"computer"}',
    '{"version":1,"selected":"computer"}\n',
    'x'.repeat(10_000),
  ])('fails closed on noncanonical persisted data without reflecting it', raw => {
    const server = vi.fn<typeof fetch>();
    const computer = vi.fn<typeof fetch>();
    const preferences = memoryStore(raw);
    let error: unknown;
    try { new MarketSourceController({ server, computer }, () => 0, preferences); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('Market source preference is invalid');
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain('private-synthetic');
    expect(preferences.setRuntimeState).not.toHaveBeenCalled();
    expect(server).not.toHaveBeenCalled();
    expect(computer).not.toHaveBeenCalled();
  });

  it('fails closed on storage read exceptions without reflecting private exception data', () => {
    const preferences: MarketSourcePreferenceStore = {
      getRuntimeState: vi.fn(() => { throw new Error('private-synthetic-token /private/synthetic-journal.sqlite'); }),
      setRuntimeState: vi.fn(),
    };
    let error: unknown;
    try { new MarketSourceController({ server: fetch, computer: fetch }, () => 0, preferences); }
    catch (caught) { error = caught; }
    expect((error as Error).message).toBe('Market source preference could not be loaded');
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain('private-synthetic');
    expect(preferences.setRuntimeState).not.toHaveBeenCalled();
  });

  it('leaves memory and scanner-report invalidation unchanged when saving a different source fails', () => {
    const preferences = memoryStore();
    preferences.setRuntimeState.mockImplementationOnce(() => {
      throw new Error('private-synthetic-token /private/synthetic-journal.sqlite');
    });
    const controller = new MarketSourceController({ server: fetch, computer: fetch }, () => 0, preferences);
    controller.recordHealth('computer', true);
    const invalidateSourceReport = vi.fn();
    // The production callback invalidates only after selection has committed.
    const selectMarketSource = () => { controller.select('computer'); invalidateSourceReport(); };
    let error: unknown;
    try { selectMarketSource(); } catch (caught) { error = caught; }
    expect((error as Error).message).toBe('Market source preference could not be saved');
    expect((error as Error).cause).toBeUndefined();
    expect(String(error)).not.toContain('private-synthetic');
    expect(controller.view().selected).toBe('server');
    expect(preferences.read()).toBeNull();
    expect(invalidateSourceReport).not.toHaveBeenCalled();
    selectMarketSource();
    expect(controller.view().selected).toBe('computer');
    expect(invalidateSourceReport).toHaveBeenCalledOnce();
  });

  it('keeps a restored computer in memory if saving a switch back to server fails', () => {
    const preferences = memoryStore('{"version":1,"selected":"computer"}');
    preferences.setRuntimeState.mockImplementationOnce(() => { throw 'private-synthetic-failure'; });
    const controller = new MarketSourceController({ server: fetch, computer: fetch }, () => 0, preferences);
    controller.recordHealth('server', true);
    expect(() => controller.select('server')).toThrow('Market source preference could not be saved');
    expect(controller.view().selected).toBe('computer');
    expect(preferences.read()).toBe('{"version":1,"selected":"computer"}');
  });

  it('does not save a selection rejected by overlapping scan leases', () => {
    const preferences = memoryStore();
    const controller = new MarketSourceController({ server: fetch, computer: fetch }, () => 0, preferences);
    controller.recordHealth('computer', true);
    const releaseFirst = controller.acquireScan();
    const releaseSecond = controller.acquireScan();
    expect(() => controller.select('computer')).toThrow('Wait for the current scan to finish');
    releaseFirst(); releaseFirst();
    expect(() => controller.select('computer')).toThrow('Wait for the current scan to finish');
    expect(preferences.setRuntimeState).not.toHaveBeenCalled();
    expect(controller.view().selected).toBe('server');
    releaseSecond(); controller.select('computer');
    expect(preferences.setRuntimeState).toHaveBeenCalledOnce();
  });

  it('does not save missing, failed, stale or future-dated health evidence', () => {
    let now = 0;
    const preferences = memoryStore();
    const controller = new MarketSourceController({ server: fetch, computer: fetch }, () => now, preferences);
    expect(() => controller.select('computer')).toThrow('Market source availability is not freshly confirmed');
    controller.recordHealth('computer', false);
    expect(() => controller.select('computer')).toThrow('Market source availability is not freshly confirmed');
    controller.recordHealth('computer', true);
    now = 60_001;
    expect(() => controller.select('computer')).toThrow('Market source availability is not freshly confirmed');
    now = -1;
    expect(() => controller.select('computer')).toThrow('Market source availability is not freshly confirmed');
    expect(preferences.setRuntimeState).not.toHaveBeenCalled();
    expect(controller.view().selected).toBe('server');
    now = 60_000;
    controller.select('computer');
    expect(preferences.setRuntimeState).toHaveBeenCalledOnce();
  });
});
