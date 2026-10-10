import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isWeekday, parseMoexCandles, scoreSberfTrade, sessionWindows, signalReturn, validateWindow } from './research/sberf-first-hour-final-half-hour.js';

const root = join(process.cwd(), '.trading', 'sberf-first-hour-final-half-hour');
const protocol = join(process.cwd(), 'docs', 'SBERF_FIRST_HOUR_TO_FINAL_HALF_HOUR_TRANSFER_V1.md');
const protocolHash = '5040838a4fe74530d220a3f0602e3ccd064eaa1a738fa3997f54708c3cf150a2';
const manifestPath = join(root, 'source-manifest.json');
const resultJson = join(root, 'results.json');
const resultMd = join(process.cwd(), 'docs', 'SBERF_FIRST_HOUR_TO_FINAL_HALF_HOUR_TRANSFER_V1_RESULTS.md');
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
type Ref = { path: string; sha256: string; url: string; kind: string; date?: string };
type Manifest = { protocolSha256: string; manifestSha256: string; sourcePages: Ref[]; windowCoverage: { date: string; signalComplete: boolean; exitComplete: boolean }[]; officialWeekdayCount: number; officialDailyDateCount: number; outcomeReturnsCalculated: false };
async function load(ref: Ref, refs: Map<string, Ref>) {
  const item = refs.get(ref.path); if (!item) throw new Error(`Unmanifested source file ${ref.path}`);
  const cache = JSON.parse(await readFile(join(process.cwd(), item.path), 'utf8')) as { url: string; sha256: string; body: string };
  if (cache.url !== item.url || cache.sha256 !== item.sha256 || sha(cache.body) !== item.sha256) throw new Error(`Source provenance mismatch: ${item.path}`);
  return parseMoexCandles(cache.body);
}
function median(values: number[]) { const x = [...values].sort((a,b)=>a-b); return x.length ? x.length % 2 ? x[(x.length-1)/2]! : (x[x.length/2-1]!+x[x.length/2]!)/2 : 0; }
function summary(rows: Trade[], field: 'netRub' | 'stressRub' = 'netRub') {
  const values = rows.map((r) => r[field]); const total = values.reduce((a,b)=>a+b,0); const top = [...values].sort((a,b)=>b-a).slice(0,5);
  const winners = values.filter((x)=>x>0).length;
  return { trades: values.length, winners, winRate: values.length ? winners/values.length : 0, meanRub: values.length ? total/values.length : 0, medianRub: median(values), totalRub: total, totalWithoutBestFiveRub: total-top.reduce((a,b)=>a+b,0) };
}
type Trade = { date: string; netRub: number; stressRub: number };
async function main() {
  if (await exists(resultJson) || await exists(resultMd)) throw new Error('Outcome report exists; refusing overwrite');
  const protocolBody = await readFile(protocol, 'utf8');
  if (sha(protocolBody) !== protocolHash) throw new Error('Frozen protocol hash mismatch');
  const m = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
  const { manifestSha256, ...base } = m;
  if (m.protocolSha256 !== protocolHash || sha(JSON.stringify(base)) !== manifestSha256 || m.outcomeReturnsCalculated !== false) throw new Error('Source checkpoint hash/status invalid');
  if (m.officialWeekdayCount !== m.windowCoverage.length) throw new Error('Source date denominator mismatch');
  const refs = new Map(m.sourcePages.map((x)=>[x.path,x])); if (refs.size !== m.sourcePages.length) throw new Error('Duplicate manifest paths');
  for (const ref of m.sourcePages) await load(ref, refs);
  const trades: Trade[] = []; const unresolved: {date:string;reason:string}[]=[]; let completeSignals=0, zeroSignals=0, nonzero=0, sourceMismatch=0;
  for (const coverage of [...m.windowCoverage].sort((a,b)=>a.date.localeCompare(b.date))) {
    if (!isWeekday(coverage.date)) throw new Error(`Weekend in weekday data: ${coverage.date}`);
    const date=coverage.date, w=sessionWindows(date);
    const signalPath=`.trading/sberf-first-hour-final-half-hour/minute/${date}-signal.json`, exitPath=`.trading/sberf-first-hour-final-half-hour/minute/${date}-exit.json`;
    const signal=await load({path:signalPath} as Ref,refs), exit=await load({path:exitPath} as Ref,refs);
    const signalOK=validateWindow(signal,date,w.signalStart,w.signalEnd,0.01), exitOK=validateWindow(exit,date,w.exitStart,w.exitEnd,0.01);
    if(signalOK!==coverage.signalComplete||exitOK!==coverage.exitComplete) sourceMismatch++;
    if(!signalOK){unresolved.push({date,reason:'incomplete_signal_window'});continue;}
    completeSignals++;
    if(signalReturn(signal)===0){zeroSignals++;continue;}
    nonzero++;
    if(!exitOK){unresolved.push({date,reason:'incomplete_entry_or_exit_window'});continue;}
    trades.push({date,netRub:scoreSberfTrade(signal,exit,1).netRub,stressRub:scoreSberfTrade(signal,exit,2).netRub});
  }
  if(sourceMismatch) throw new Error(`Source coverage mismatch on ${sourceMismatch} dates`);
  const all=summary(trades), stress=summary(trades,'stressRub');
  const periods=Object.fromEntries(['2024','2025','2026'].map((year)=>[year,summary(trades.filter(x=>x.date.startsWith(year)))]));
  const gates={sample:all.trades>=100&&new Set(trades.map(x=>x.date)).size>=50,winRate:all.winRate>=0.51,meanAndMedian:all.meanRub>0&&all.medianRub>0,eachCalendarBlock:Object.values(periods).every(x=>x.trades>0&&x.totalRub>0),stress:stress.totalRub>0,withoutBestFive:all.totalWithoutBestFiveRub>0,noUnresolved:unresolved.length===0};
  const decision=Object.values(gates).every(Boolean)?'PASS_TO_PROSPECTIVE_SHADOW_ONLY':'REJECT_THIS_RULE';
  const result={version:1,instrument:'SBERF',board:'RFUD',protocolSha256:protocolHash,sourceManifestSha256:manifestSha256,officialDailyDateCount:m.officialDailyDateCount,officialWeekdayCount:m.officialWeekdayCount,completeSignalWindows:completeSignals,zeroSignalsInCash:zeroSignals,nonzeroSignalsRequiringExecution:nonzero,unresolvedDates:unresolved,base:all,stress,calendarBlocks:periods,gates,decision,caveat:'Exploratory cross-instrument transfer after failed IMOEXF, not independent confirmation. MOEX OHLC bars and fixed adverse ticks do not establish executable fills; current published fees are historical proxies; no orders were placed.',calculatedAtUtc:new Date().toISOString()};
  const md=['# SBERF first-hour to final-half-hour transfer v1 — result','',`Protocol SHA-256: \`${protocolHash}\`; source-manifest SHA-256: \`${manifestSha256}\`.`,'',`**Decision: ${decision}.** Exploratory transfer after the failed IMOEXF screen; not independent confirmation and not executable-fill evidence.`,'',`Official calendar: ${m.officialDailyDateCount} sessions / ${m.officialWeekdayCount} weekdays; complete signal windows ${completeSignals}; zero signals ${zeroSignals}; nonzero signals ${nonzero}; unresolved ${unresolved.length}.`,'','| Period | Trades | Net wins | Win rate | Mean RUB | Median RUB | Total RUB |','|---|---:|---:|---:|---:|---:|---:|',`| Combined | ${all.trades} | ${all.winners} | ${(all.winRate*100).toFixed(2)}% | ${all.meanRub.toFixed(2)} | ${all.medianRub.toFixed(2)} | ${all.totalRub.toFixed(2)} |`,...Object.entries(periods).map(([year,x])=>`| ${year} | ${x.trades} | ${x.winners} | ${(x.winRate*100).toFixed(2)}% | ${x.meanRub.toFixed(2)} | ${x.medianRub.toFixed(2)} | ${x.totalRub.toFixed(2)} |`),'',`Stress aggregate: RUB ${stress.totalRub.toFixed(2)}. Base aggregate excluding five best trades: RUB ${all.totalWithoutBestFiveRub.toFixed(2)}.`,'','## Gates','',...Object.entries(gates).map(([k,v])=>`- ${v?'PASS':'FAIL'} — ${k}`),'',`Unresolved dates: ${unresolved.length ? unresolved.map(x=>`${x.date} (${x.reason})`).join(', ') : 'none'}.`,'',result.caveat,''].join('\n');
  await writeFile(resultJson,JSON.stringify(result,null,2),{encoding:'utf8',flag:'wx',mode:0o600}); await writeFile(resultMd,md,{encoding:'utf8',flag:'wx',mode:0o600});
  process.stdout.write(`${decision}; trades=${all.trades}; wins=${all.winners}/${all.trades}; net=${all.totalRub.toFixed(2)}; stress=${stress.totalRub.toFixed(2)}; unresolved=${unresolved.length}\n`);
}
async function exists(p:string){try{await readFile(p);return true;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e;}}
main().catch((e:unknown)=>{process.stderr.write(`SBERF outcome screen failed: ${e instanceof Error?e.message:'unknown error'}\n`);process.exitCode=1;});
