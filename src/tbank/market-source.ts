export type MarketSourceId = 'server' | 'computer';
export const marketSourcePreferenceKey = 'market.source.selection.v1';
export interface MarketSourcePreferenceStore {
  getRuntimeState(key: string): string | null;
  setRuntimeState(key: string, value: string): void;
}
const sourcePreferences = {
  server: '{"version":1,"selected":"server"}',
  computer: '{"version":1,"selected":"computer"}',
} as const;
type Health = { checkedAt: number; available: boolean };
export class MarketSourceController {
  private selected: MarketSourceId = 'server';
  private leases = 0;
  private readonly health = new Map<MarketSourceId, Health>();
  private readonly locations = new Map<MarketSourceId, { countryCode: string; checkedAt: number }>();
  constructor(private readonly sources: { server: typeof fetch; computer?: typeof fetch },
    private readonly clock: () => number = Date.now,
    private readonly preferences?: MarketSourcePreferenceStore) {
    if (!preferences) return;
    let raw: string | null;
    try { raw = preferences.getRuntimeState(marketSourcePreferenceKey); }
    catch { throw new Error('Market source preference could not be loaded'); }
    if (raw === null) return;
    // Exact canonical records reject extra fields, duplicate keys and arbitrary
    // persisted bytes. A preference never restores transport health or leases.
    if (raw === sourcePreferences.server) this.selected = 'server';
    else if (raw === sourcePreferences.computer) this.selected = 'computer';
    else throw new Error('Market source preference is invalid');
  }
  readonly fetch: typeof fetch = async (input, init) => {
    const source = this.selected;
    const transport = this.sources[source];
    if (!transport) throw new Error('Selected market source is not configured');
    return transport(input, init);
  };
  private freshlyAvailable(source: MarketSourceId): boolean {
    const health = this.health.get(source);
    const age = health ? this.clock() - health.checkedAt : Infinity;
    return Boolean(health?.available && age >= 0 && age <= 60_000);
  }
  recordHealth(source: MarketSourceId, available: boolean): void {
    this.health.set(source, { checkedAt: this.clock(), available });
  }
  recordLocation(source: MarketSourceId, location: { countryCode: string; checkedAt: string }): void {
    const checkedAt = Date.parse(location.checkedAt);
    if (!/^[A-Z]{2}$/.test(location.countryCode) || ['XX', 'ZZ'].includes(location.countryCode)
      || !Number.isFinite(checkedAt) || checkedAt > this.clock() + 60_000) return;
    this.locations.set(source, { countryCode: location.countryCode, checkedAt });
  }
  view() {
    return { selected: this.selected, busy: this.leases > 0,
      sources: (['server', 'computer'] as const).map(id => {
        const health = this.health.get(id);
        const age = health ? this.clock() - health.checkedAt : Infinity;
        const location = this.locations.get(id);
        const locationFresh = location && this.clock() - location.checkedAt <= 86_400_000 && location.checkedAt <= this.clock() + 60_000;
        return { id, configured: Boolean(this.sources[id]), available: Boolean(health?.available && age >= 0 && age <= 60_000),
          checkedAt: health ? new Date(health.checkedAt).toISOString() : null,
          countryCode: locationFresh ? location.countryCode : null,
          locationCheckedAt: locationFresh ? new Date(location.checkedAt).toISOString() : null };
      }) };
  }
  select(source: MarketSourceId): void {
    if (this.leases) throw new Error('Wait for the current scan to finish');
    if (!this.freshlyAvailable(source) || !this.sources[source]) {
      throw new Error('Market source availability is not freshly confirmed');
    }
    // Commit the tiny durable record before changing the in-memory selection.
    // Callers invalidate old scanner reports only after this method succeeds.
    try { this.preferences?.setRuntimeState(marketSourcePreferenceKey, sourcePreferences[source]); }
    catch { throw new Error('Market source preference could not be saved'); }
    this.selected = source;
  }
  acquireScan(): () => void {
    this.leases++;
    let released = false;
    return () => { if (!released) { released = true; this.leases--; } };
  }
}
