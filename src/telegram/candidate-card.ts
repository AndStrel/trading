import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppConfig } from '../config.js';
import type { JournalScenarioRecord } from '../journal/scenario-journal.js';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null ? (value as UnknownRecord) : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (character) => {
    const entities: Record<string, string> = {
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;',
    };
    return entities[character] ?? character;
  });
}

function formatNumber(value: number | null): string {
  if (value === null) return '—';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatRubles(value: number | null): string {
  return value === null ? '—' : `${formatNumber(value)} ₽`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function svgText(x: number, y: number, text: string, options: {
  size: number;
  weight?: number;
  fill?: string;
  anchor?: 'start' | 'middle' | 'end';
}): string {
  return `<text x="${x}" y="${y}" font-family="DejaVu Sans, sans-serif" font-size="${options.size}" font-weight="${options.weight ?? 400}" fill="${options.fill ?? '#E5E7EB'}" text-anchor="${options.anchor ?? 'start'}">${escapeXml(text)}</text>`;
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', (error) => reject(error));
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
    });
  });
}

export function buildCandidateCardSvg(record: JournalScenarioRecord, config: AppConfig): string {
  const instrument =
    config.scanner.intradayWatchlist.find((item) => item.instrumentId === record.instrumentId)?.label ??
    record.instrumentId;
  const snapshot = asRecord(record.snapshot);
  const plan = asRecord(snapshot?.tradePlan);
  const market = asRecord(snapshot?.market);
  const candle = asRecord(snapshot?.candleAnalysis);

  const lots = asFiniteNumber(plan?.lots);
  const units = asFiniteNumber(plan?.units);
  const positionRub = asFiniteNumber(plan?.positionRub);
  const totalRiskRub = asFiniteNumber(plan?.totalRiskRub);
  const commissionRub = asFiniteNumber(plan?.estimatedCommissionRub);
  const slippageRub = asFiniteNumber(plan?.estimatedSlippageRub);
  const netRewardRub = asFiniteNumber(plan?.netRewardRub);
  const rewardToRisk = asFiniteNumber(plan?.rewardToRisk);
  const bestBid = asFiniteNumber(market?.bestBid);
  const bestAsk = asFiniteNumber(market?.bestAsk);
  const spreadPct = asFiniteNumber(market?.spreadPct);
  const trend = typeof candle?.trend === 'string' ? candle.trend : '—';
  const relativeVolume = asFiniteNumber(candle?.relativeVolume);
  const atr = asFiniteNumber(candle?.averageTrueRange14);

  const direction = record.input.side === 'long' ? 'LONG' : 'SHORT';
  const directionColor = record.input.side === 'long' ? '#34D399' : '#FB7185';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350">
  <rect width="1080" height="1350" fill="#09111F"/>
  <circle cx="960" cy="105" r="220" fill="#12304A" opacity="0.65"/>
  <circle cx="104" cy="1275" r="290" fill="#112A3B" opacity="0.8"/>
  <rect x="48" y="48" width="984" height="1254" rx="40" fill="#101B2E" stroke="#263A53" stroke-width="2"/>

  <text x="96" y="126" font-family="DejaVu Sans, sans-serif" font-size="28" font-weight="700" fill="#94A3B8" letter-spacing="4">INTRADAY CANDIDATE</text>
  ${svgText(96, 218, instrument, { size: 76, weight: 700, fill: '#F8FAFC' })}
  ${svgText(96, 268, `#${record.id} · ${formatTime(record.observedAt)} МСК`, { size: 28, fill: '#94A3B8' })}
  <rect x="806" y="170" width="170" height="58" rx="29" fill="${directionColor}" opacity="0.16"/>
  ${svgText(891, 209, direction, { size: 28, weight: 700, fill: directionColor, anchor: 'middle' })}

  <line x1="96" x2="984" y1="322" y2="322" stroke="#263A53" stroke-width="2"/>
  ${svgText(96, 386, 'ПЛАН СДЕЛКИ', { size: 24, weight: 700, fill: '#94A3B8' })}

  <rect x="96" y="420" width="272" height="156" rx="22" fill="#15243A"/>
  <rect x="404" y="420" width="272" height="156" rx="22" fill="#201C30"/>
  <rect x="712" y="420" width="272" height="156" rx="22" fill="#132C2A"/>
  ${svgText(124, 462, 'ВХОД', { size: 22, weight: 700, fill: '#94A3B8' })}
  ${svgText(124, 530, formatRubles(record.input.entryPrice), { size: 40, weight: 700, fill: '#F8FAFC' })}
  ${svgText(432, 462, 'СТОП', { size: 22, weight: 700, fill: '#FDA4AF' })}
  ${svgText(432, 530, formatRubles(record.input.stopPrice), { size: 40, weight: 700, fill: '#F8FAFC' })}
  ${svgText(740, 462, 'ЦЕЛЬ', { size: 22, weight: 700, fill: '#6EE7B7' })}
  ${svgText(740, 530, formatRubles(record.input.targetPrice), { size: 40, weight: 700, fill: '#F8FAFC' })}

  <rect x="96" y="620" width="888" height="156" rx="22" fill="#0D1728" stroke="#263A53" stroke-width="2"/>
  ${svgText(126, 668, 'ОБЪЁМ', { size: 22, weight: 700, fill: '#94A3B8' })}
  ${svgText(126, 728, lots === null || units === null ? '—' : `${formatNumber(lots)} лот. · ${formatNumber(units)} шт.`, { size: 36, weight: 700, fill: '#F8FAFC' })}
  ${svgText(954, 668, 'ПОЗИЦИЯ', { size: 22, weight: 700, fill: '#94A3B8', anchor: 'end' })}
  ${svgText(954, 728, formatRubles(positionRub), { size: 36, weight: 700, fill: '#F8FAFC', anchor: 'end' })}

  ${svgText(96, 846, 'РИСК И ПОТЕНЦИАЛ', { size: 24, weight: 700, fill: '#94A3B8' })}
  <rect x="96" y="880" width="424" height="146" rx="22" fill="#331B2A"/>
  <rect x="560" y="880" width="424" height="146" rx="22" fill="#13332C"/>
  ${svgText(126, 926, 'МАКС. РИСК С ЗАТРАТАМИ', { size: 18, weight: 700, fill: '#FDA4AF' })}
  ${svgText(126, 986, formatRubles(totalRiskRub), { size: 42, weight: 700, fill: '#F8FAFC' })}
  ${svgText(590, 926, 'ПОТЕНЦИАЛ ЧИСТЫМИ', { size: 18, weight: 700, fill: '#6EE7B7' })}
  ${svgText(590, 986, formatRubles(netRewardRub), { size: 42, weight: 700, fill: '#F8FAFC' })}

  <rect x="96" y="1070" width="888" height="118" rx="22" fill="#0D1728"/>
  ${svgText(126, 1116, 'КОМИССИЯ + ПРОСКАЛЬЗЫВАНИЕ', { size: 18, weight: 700, fill: '#94A3B8' })}
  ${svgText(126, 1162, `${formatRubles(commissionRub)} + ${formatRubles(slippageRub)}`, { size: 28, weight: 700, fill: '#F8FAFC' })}
  ${svgText(954, 1116, 'R/R', { size: 18, weight: 700, fill: '#94A3B8', anchor: 'end' })}
  ${svgText(954, 1162, formatNumber(rewardToRisk), { size: 32, weight: 700, fill: '#5EEAD4', anchor: 'end' })}

  ${svgText(96, 1242, `РЫНОК: bid ${formatRubles(bestBid)} · ask ${formatRubles(bestAsk)} · спред ${spreadPct === null ? '—' : `${formatNumber(spreadPct)}%`}`, { size: 23, fill: '#CBD5E1' })}
  ${svgText(96, 1282, `5М: ${trend} · объём ${formatNumber(relativeVolume)} · ATR ${formatRubles(atr)}`, { size: 23, fill: '#94A3B8' })}
  <rect x="758" y="1230" width="226" height="52" rx="26" fill="#1E293B"/>
  ${svgText(871, 1264, 'РУЧНАЯ ПРОВЕРКА', { size: 16, weight: 700, fill: '#CBD5E1', anchor: 'middle' })}
</svg>`;
}

export async function renderCandidateCardPng(svg: string): Promise<Uint8Array> {
  const directory = await mkdtemp(join(tmpdir(), 'trading-candidate-card-'));
  const inputPath = join(directory, 'candidate.svg');
  const outputPath = join(directory, 'candidate.png');

  try {
    await writeFile(inputPath, svg, { mode: 0o600 });
    await run('rsvg-convert', ['--width', '1080', '--height', '1350', '--output', outputPath, inputPath]);
    return await readFile(outputPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
