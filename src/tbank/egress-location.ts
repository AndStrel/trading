export type EgressLocation = { countryCode: string; checkedAt: string };
/** No broker credentials or caller-supplied IP/URL are sent to the geolocation provider. */
export async function readEgressLocation(fetchImpl: typeof fetch = fetch): Promise<EgressLocation> {
  const response = await fetchImpl('https://api.country.is/', { redirect: 'error', signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Egress location unavailable');
  const value = await response.json() as { country?: unknown };
  if (typeof value.country !== 'string' || !/^[A-Z]{2}$/.test(value.country) || ['XX', 'ZZ'].includes(value.country)) {
    throw new Error('Egress country unconfirmed');
  }
  return { countryCode: value.country, checkedAt: new Date().toISOString() };
}
