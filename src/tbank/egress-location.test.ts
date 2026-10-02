import {describe,it,expect,vi} from 'vitest';
import {readEgressLocation} from './egress-location.js';
import {MarketSourceController} from './market-source.js';
describe('egress country attribution',()=>{
 it('calls only the fixed provider without broker credentials and discards the IP',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"ip":"192.0.2.1","country":"DE"}'));
  const value=await readEgressLocation(f);expect(value.countryCode).toBe('DE');expect(value).not.toHaveProperty('ip');
  expect(f.mock.calls[0]?.[0]).toBe('https://api.country.is/');expect(f.mock.calls[0]?.[1]).not.toHaveProperty('headers');
 });
 it('does not turn unknown geolocation into a flag or API availability',async()=>{
  const f=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"country":"<script>"}'));
  await expect(readEgressLocation(f)).rejects.toThrow();
  let now=0;const c=new MarketSourceController({server:fetch},()=>now);
  c.recordLocation('server',{countryCode:'DE',checkedAt:new Date(now).toISOString()});
  expect(c.view().sources[0]).toMatchObject({countryCode:'DE',available:false});
  now=86400001;expect(c.view().sources[0]?.countryCode).toBeNull();
 });
});
