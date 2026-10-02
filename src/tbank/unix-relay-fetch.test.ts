import {describe,it,expect} from 'vitest';
import {createUnixRelayFetch} from './unix-relay-fetch.js';
describe('fixed private socket transport',()=>{
 it('does not accept arbitrary sockets or hosts',async()=>{
  expect(()=>createUnixRelayFetch('/var/run/docker.sock')).toThrow();
  const f=createUnixRelayFetch('/run/relay/market.sock');
  for(const url of ['http://evil.invalid/market-data','http://127.0.0.1/admin','http://127.0.0.1/market-data?url=x','https://127.0.0.1/egress']) {
   await expect(f(url)).rejects.toThrow('Invalid relay request');
  }
 });
 it('fails explicitly when the SSH socket is unavailable',async()=>{
  const f=createUnixRelayFetch('/run/relay/market.sock');
  await expect(f('http://127.0.0.1/market-data',{method:'POST',body:'{}',signal:AbortSignal.timeout(1000)})).rejects.toThrow();
 });
});
