import {afterEach,describe,it,expect,vi} from 'vitest';
import {once} from 'node:events';
import type {Server} from 'node:http';
import {createMarketRelay,parseMarketRelayRequest,marketRelayMethods} from './market-relay.js';
const servers:Server[]=[];
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}});
async function start() {
 const upstream=vi.fn<typeof fetch>().mockResolvedValue(new Response('{"candles":[]}'));
 const server=createMarketRelay({secret:'s'.repeat(32),readToken:'synthetic-read',fetchImpl:upstream});servers.push(server);
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();
 if(!address||typeof address==='string')throw Error();
 return {url:`http://127.0.0.1:${address.port}/market-data`,upstream};
}
const headers={Authorization:'Bearer '+'s'.repeat(32),'Content-Type':'application/json'};
describe('market-only local relay',()=>{
 it('rejects broker writes, account methods, caller URLs and credential fields',()=>{
  for(const method of ['SandboxService/PostSandboxOrder','OrdersService/PostOrder','UsersService/GetAccounts']) {
   expect(()=>parseMarketRelayRequest({method:'tinkoff.public.invest.api.contract.v1.'+method,body:{}})).toThrow();
  }
  expect(()=>parseMarketRelayRequest({method:marketRelayMethods[0],body:{},url:'https://evil.invalid'})).toThrow();
  expect(()=>parseMarketRelayRequest({method:marketRelayMethods[0],body:{},token:'secret'})).toThrow();
 });
 it('requires authentication before forwarding',async()=>{
  const {url,upstream}=await start();
  expect((await fetch(url,{method:'POST',body:'{}'})).status).toBe(401);
  expect(upstream).not.toHaveBeenCalled();
 });
 it('uses only the fixed official endpoint and local read credential',async()=>{
  const {url,upstream}=await start();const body={instrumentId:'synthetic-instrument'};
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({method:marketRelayMethods[1],body})});
  expect(response.status).toBe(200);expect(await response.json()).toEqual({candles:[]});
  expect(upstream.mock.calls[0]?.[0]).toBe('https://invest-public-api.tbank.ru/rest/'+marketRelayMethods[1]);
  expect(upstream.mock.calls[0]?.[1]).toMatchObject({redirect:'error',headers:{Authorization:'Bearer synthetic-read'},body:JSON.stringify(body)});
 });
 it('does not leak upstream errors or forward rejected methods',async()=>{
  const {url,upstream}=await start();
  expect((await fetch(url,{method:'POST',headers,body:JSON.stringify({method:'PostOrder',body:{}})})).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
  upstream.mockRejectedValueOnce(new Error('synthetic-sensitive-error'));
  const response=await fetch(url,{method:'POST',headers,body:JSON.stringify({method:marketRelayMethods[0],body:{}})});
  expect(response.status).toBe(502);expect(await response.text()).not.toContain('synthetic-sensitive-error');
 });
});
