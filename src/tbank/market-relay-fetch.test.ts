import {describe,it,expect,vi} from 'vitest';
import {createMarketRelayFetch} from './market-relay-fetch.js';
import {marketRelayMethods} from './market-relay.js';
const official='https://invest-public-api.tbank.ru/rest/';
const settings={url:'http://127.0.0.1:13877/market-data',secret:'s'.repeat(32)};
describe('local market transport',()=>{
 it('accepts only a fixed loopback relay without URL credentials or query',()=>{
  for(const url of ['http://evil.invalid/market-data','https://127.0.0.1/market-data','http://user:password@127.0.0.1/market-data','http://127.0.0.1/market-data?token=x']) {
   expect(()=>createMarketRelayFetch({...settings,url})).toThrow();
  }
 });
 it('strips broker credentials and forwards only the market payload',async()=>{
  const upstream=vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
  const relay=createMarketRelayFetch({...settings,fetchImpl:upstream});
  await relay(official+marketRelayMethods[1],{method:'POST',headers:{Authorization:'Bearer synthetic-broker-token'},body:'{"instrumentId":"synthetic"}'});
  expect(upstream).toHaveBeenCalledOnce();
  expect(upstream.mock.calls[0]?.[0]).toBe(settings.url);
  const forwarded=upstream.mock.calls[0]?.[1];
  expect(JSON.stringify(forwarded)).not.toContain('synthetic-broker-token');
  expect(forwarded).toMatchObject({redirect:'error',headers:{Authorization:'Bearer '+settings.secret}});
 });
 it('rejects account, order, other-origin and malformed requests before network',async()=>{
  const upstream=vi.fn<typeof fetch>();const relay=createMarketRelayFetch({...settings,fetchImpl:upstream});
  for(const url of [official+'tinkoff.public.invest.api.contract.v1.OrdersService/PostOrder',official+'tinkoff.public.invest.api.contract.v1.UsersService/GetAccounts','https://evil.invalid/rest/'+marketRelayMethods[0]]) {
   await expect(relay(url,{method:'POST',body:'{}'})).rejects.toThrow();
  }
  await expect(relay(official+marketRelayMethods[0],{method:'POST',body:'null'})).rejects.toThrow();
  expect(upstream).not.toHaveBeenCalled();
 });
 it('does not silently fall back after a local source disconnect',async()=>{
  const upstream=vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
  const relay=createMarketRelayFetch({...settings,fetchImpl:upstream});
  await expect(relay(official+marketRelayMethods[0],{method:'POST',body:'{}'})).rejects.toThrow('offline');
  expect(upstream).toHaveBeenCalledOnce();
 });
});
