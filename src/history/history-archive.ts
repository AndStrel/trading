import { createHash } from 'node:crypto';

import { strFromU8, unzipSync } from 'fflate';

import type { HistoricalMinuteCandle } from './market-data-store.js';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_CSV_BYTES = 256 * 1024 * 1024;

export type ParsedHistoryArchive = {
  candles: HistoricalMinuteCandle[];
  rawRowCount: number;
  invalidRowCount: number;
  duplicateRowCount: number;
};

export type HistoryArchiveParseInput = {
  instrumentId: string;
  year: number;
};

function splitCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = '';
      continue;
    }
    value += character;
  }

  if (quoted) throw new Error('Historical archive CSV has an unclosed quoted field');
  values.push(value.trim());
  return values;
}

function delimiterCount(line: string, delimiter: string): number {
  let quoted = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      count += 1;
    }
  }
  return count;
}

function detectDelimiter(header: string): string {
  const candidates = [',', ';', '\t'];
  const selected = candidates
    .map((candidate) => ({ candidate, count: delimiterCount(header, candidate) }))
    .sort((left, right) => right.count - left.count)[0];

  if (!selected || selected.count < 1) {
    throw new Error('Historical archive CSV delimiter is not recognized');
  }
  return selected.candidate;
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replaceAll(/[\s_-]/g, '');
}

function getColumnIndex(headers: string[], aliases: string[], label: string): number {
  const index = headers.findIndex((header) => aliases.includes(normalizeHeader(header)));
  if (index < 0) throw new Error(`Historical archive CSV is missing ${label} column`);
  return index;
}

function readCell(row: string[], index: number): string | null {
  const value = row[index];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseDecimal(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.replaceAll(/\s/g, '').replace(',', '.');
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseTimestamp(value: string | null): string | null {
  if (!value) return null;
  let normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(normalized)) {
    normalized = `${normalized.replace(' ', 'T')}Z`;
  }
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function readCsvFromZip(archive: Uint8Array): string {
  if (archive.byteLength === 0) throw new Error('Historical archive is empty');
  if (archive.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`Historical archive exceeds ${MAX_ARCHIVE_BYTES} byte safety limit`);
  }

  let files: Record<string, Uint8Array>;
  const csvEntries: Array<{ name: string; originalSize: number }> = [];
  const unexpectedEntries: string[] = [];
  let csvExceedsSafetyLimit = false;
  try {
    files = unzipSync(archive, {
      // Do not decompress arbitrary extra files from an archive. The documented response
      // contains one CSV; the filter also prevents a ZIP bomb in a rejected entry.
      filter(file) {
        if (file.name.endsWith('/')) return false;
        if (!file.name.toLowerCase().endsWith('.csv')) {
          unexpectedEntries.push(file.name);
          return false;
        }
        csvEntries.push({ name: file.name, originalSize: file.originalSize });
        if (file.originalSize > MAX_CSV_BYTES) {
          csvExceedsSafetyLimit = true;
          return false;
        }
        return true;
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown ZIP error';
    throw new Error(`Historical archive ZIP cannot be read: ${detail}`);
  }

  if (csvEntries.length !== 1) {
    throw new Error('Historical archive must contain exactly one CSV file');
  }
  if (unexpectedEntries.length > 0) {
    throw new Error('Historical archive must not contain files other than its CSV');
  }
  if (csvExceedsSafetyLimit) {
    throw new Error(`Historical archive CSV exceeds ${MAX_CSV_BYTES} byte safety limit`);
  }

  const entry = csvEntries[0]!;
  const bytes = files[entry.name];
  if (!bytes || bytes.byteLength !== entry.originalSize) throw new Error('Historical archive CSV cannot be read');
  return strFromU8(bytes);
}

function isValidCandle(input: {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}): boolean {
  return (
    input.open > 0 &&
    input.high > 0 &&
    input.low > 0 &&
    input.close > 0 &&
    input.high >= input.low &&
    input.open >= input.low &&
    input.open <= input.high &&
    input.close >= input.low &&
    input.close <= input.high &&
    Number.isSafeInteger(input.volume) &&
    input.volume >= 0
  );
}

export function archiveSha256(archive: Uint8Array): string {
  return createHash('sha256').update(archive).digest('hex');
}

export function parseHistoryMinuteArchive(
  archive: Uint8Array,
  input: HistoryArchiveParseInput,
): ParsedHistoryArchive {
  if (!input.instrumentId.trim()) throw new Error('History archive instrumentId is required');
  if (!Number.isInteger(input.year) || input.year < 2000) {
    throw new Error('History archive year is invalid');
  }

  const csv = readCsvFromZip(archive);
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const header = lines.shift();
  if (!header) throw new Error('Historical archive CSV is empty');

  const delimiter = detectDelimiter(header);
  const headers = splitCsvLine(header, delimiter);
  const uidIndex = getColumnIndex(headers, ['uid', 'instrumentuid'], 'UID');
  const timeIndex = getColumnIndex(headers, ['utc', 'time', 'timestamp'], 'UTC');
  const openIndex = getColumnIndex(headers, ['open'], 'open');
  const closeIndex = getColumnIndex(headers, ['close'], 'close');
  const highIndex = getColumnIndex(headers, ['high'], 'high');
  const lowIndex = getColumnIndex(headers, ['low'], 'low');
  const volumeIndex = getColumnIndex(headers, ['volume'], 'volume');

  const byTime = new Map<string, HistoricalMinuteCandle>();
  let invalidRowCount = 0;
  let duplicateRowCount = 0;

  for (const line of lines) {
    let row: string[];
    try {
      row = splitCsvLine(line, delimiter);
    } catch {
      invalidRowCount += 1;
      continue;
    }

    const uid = readCell(row, uidIndex);
    const time = parseTimestamp(readCell(row, timeIndex));
    const open = parseDecimal(readCell(row, openIndex));
    const close = parseDecimal(readCell(row, closeIndex));
    const high = parseDecimal(readCell(row, highIndex));
    const low = parseDecimal(readCell(row, lowIndex));
    const volume = parseDecimal(readCell(row, volumeIndex));

    if (
      uid !== input.instrumentId ||
      !time ||
      new Date(time).getUTCFullYear() !== input.year ||
      open === null ||
      close === null ||
      high === null ||
      low === null ||
      volume === null ||
      !isValidCandle({ open, close, high, low, volume })
    ) {
      invalidRowCount += 1;
      continue;
    }

    if (byTime.has(time)) duplicateRowCount += 1;
    byTime.set(time, {
      instrumentId: input.instrumentId,
      time,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  const candles = [...byTime.values()].sort((left, right) => left.time.localeCompare(right.time));
  if (candles.length === 0) throw new Error('Historical archive has no valid candles for the requested instrument and year');

  return {
    candles,
    rawRowCount: lines.length,
    invalidRowCount,
    duplicateRowCount,
  };
}
