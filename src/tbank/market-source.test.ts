import {describe,it,expect,vi} from 'vitest';
import {MarketSourceController} from './market-source.js';
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
