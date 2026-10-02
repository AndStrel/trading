export type MarketSourceId = 'server' | 'computer';
type Health = { checkedAt: number; available: boolean };
export class MarketSourceController {
  private selected: MarketSourceId = 'server';
  private leases = 0;
  private readonly health = new Map<MarketSourceId, Health>();
  private readonly locations = new Map<MarketSourceId, { countryCode: string; checkedAt: number }>();
  constructor(private readonly sources: { server: typeof fetch; computer?: typeof fetch },
    private readonly clock: () => number = Date.now) {}
  readonly fetch: typeof fetch = async (input, init) => {
    const source = this.selected;
    const transport = this.sources[source];
    if (!transport) throw new Error('Selected market source is not configured');
    return transport(input, init);
  };
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
    if (!this.view().sources.find(item => item.id === source)?.available || !this.sources[source]) {
      throw new Error('Market source availability is not freshly confirmed');
    }
    this.selected = source;
  }
  acquireScan(): () => void {
    this.leases++;
    let released = false;
    return () => { if (!released) { released = true; this.leases--; } };
  }
}
