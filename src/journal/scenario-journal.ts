import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { Strategy } from '../config.js';

export type JournalScenarioInput = {
  observedAt: string;
  strategy: Strategy;
  instrumentId: string;
  input: {
    side: 'long' | 'short';
    entryPrice: number;
    stopPrice: number;
    targetPrice: number;
    lotSize: number;
    slippageRate: number;
  };
  decision: 'candidate' | 'review' | 'blocked';
  blockers: string[];
  warnings: string[];
  snapshot: unknown;
  note?: string;
};

export type JournalScenarioRecord = JournalScenarioInput & {
  id: number;
  recordedAt: string;
};

export type PaperTradeStatus = 'open' | 'closed';

export type PaperTradeInput = {
  scenarioId: number;
  strategy: Strategy;
  instrumentId: string;
  side: 'long' | 'short';
  lots: number;
  units: number;
  entryMarketPrice: number;
  entryFillPrice: number;
  entryCommissionRub: number;
  entrySlippageRub: number;
  commissionRate: number;
  slippageRate: number;
};

export type PaperTradeRecord = PaperTradeInput & {
  id: number;
  status: PaperTradeStatus;
  openedAt: string;
  closedAt?: string;
  exitMarketPrice?: number;
  exitFillPrice?: number;
  exitCommissionRub?: number;
  exitSlippageRub?: number;
  grossPnlRub?: number;
  totalCommissionRub?: number;
  totalSlippageRub?: number;
  netPnlRub?: number;
  closeNote?: string;
};

export type PaperTradeCloseInput = {
  id: number;
  exitMarketPrice: number;
  exitFillPrice: number;
  exitCommissionRub: number;
  exitSlippageRub: number;
  grossPnlRub: number;
  totalCommissionRub: number;
  totalSlippageRub: number;
  netPnlRub: number;
  closeNote?: string;
};

type JournalRow = {
  id: number | bigint;
  recorded_at: string;
  observed_at: string;
  strategy: Strategy;
  instrument_id: string;
  side: 'long' | 'short';
  entry_price: number;
  stop_price: number;
  target_price: number;
  lot_size: number;
  slippage_rate: number;
  decision: 'candidate' | 'review' | 'blocked';
  blockers_json: string;
  warnings_json: string;
  snapshot_json: string;
  note: string | null;
};

type PaperTradeRow = {
  id: number | bigint;
  scenario_id: number | bigint;
  status: PaperTradeStatus;
  strategy: Strategy;
  instrument_id: string;
  side: 'long' | 'short';
  lots: number;
  units: number;
  opened_at: string;
  entry_market_price: number;
  entry_fill_price: number;
  entry_commission_rub: number;
  entry_slippage_rub: number;
  commission_rate: number;
  slippage_rate: number;
  closed_at: string | null;
  exit_market_price: number | null;
  exit_fill_price: number | null;
  exit_commission_rub: number | null;
  exit_slippage_rub: number | null;
  gross_pnl_rub: number | null;
  total_commission_rub: number | null;
  total_slippage_rub: number | null;
  net_pnl_rub: number | null;
  close_note: string | null;
};

const schema = `
  CREATE TABLE IF NOT EXISTS scenario_journal (
    id INTEGER PRIMARY KEY,
    recorded_at TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    strategy TEXT NOT NULL CHECK(strategy IN ('intraday', 'swing')),
    instrument_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('long', 'short')),
    entry_price REAL NOT NULL,
    stop_price REAL NOT NULL,
    target_price REAL NOT NULL,
    lot_size INTEGER NOT NULL,
    slippage_rate REAL NOT NULL,
    decision TEXT NOT NULL CHECK(decision IN ('candidate', 'review', 'blocked')),
    blockers_json TEXT NOT NULL,
    warnings_json TEXT NOT NULL,
    snapshot_json TEXT NOT NULL,
    note TEXT
  ) STRICT;

  CREATE INDEX IF NOT EXISTS scenario_journal_recorded_at
    ON scenario_journal(recorded_at DESC);

  CREATE TABLE IF NOT EXISTS paper_trades (
    id INTEGER PRIMARY KEY,
    scenario_id INTEGER NOT NULL UNIQUE REFERENCES scenario_journal(id),
    status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
    strategy TEXT NOT NULL CHECK(strategy IN ('intraday', 'swing')),
    instrument_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('long', 'short')),
    lots INTEGER NOT NULL CHECK(lots > 0),
    units INTEGER NOT NULL CHECK(units > 0),
    opened_at TEXT NOT NULL,
    entry_market_price REAL NOT NULL,
    entry_fill_price REAL NOT NULL,
    entry_commission_rub REAL NOT NULL,
    entry_slippage_rub REAL NOT NULL,
    commission_rate REAL NOT NULL,
    slippage_rate REAL NOT NULL,
    closed_at TEXT,
    exit_market_price REAL,
    exit_fill_price REAL,
    exit_commission_rub REAL,
    exit_slippage_rub REAL,
    gross_pnl_rub REAL,
    total_commission_rub REAL,
    total_slippage_rub REAL,
    net_pnl_rub REAL,
    close_note TEXT
  ) STRICT;

  CREATE INDEX IF NOT EXISTS paper_trades_status_opened_at
    ON paper_trades(status, opened_at DESC);
`;

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

export class ScenarioJournal {
  private readonly databasePath: string;

  constructor(databasePath: string) {
    this.databasePath = resolve(databasePath);
  }

  record(input: JournalScenarioInput): JournalScenarioRecord {
    const database = this.open();

    try {
      const recordedAt = new Date().toISOString();
      const insertion = database
        .prepare(
          `INSERT INTO scenario_journal (
            recorded_at, observed_at, strategy, instrument_id, side,
            entry_price, stop_price, target_price, lot_size, slippage_rate, decision,
            blockers_json, warnings_json, snapshot_json, note
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          recordedAt,
          input.observedAt,
          input.strategy,
          input.instrumentId,
          input.input.side,
          input.input.entryPrice,
          input.input.stopPrice,
          input.input.targetPrice,
          input.input.lotSize,
          input.input.slippageRate,
          input.decision,
          JSON.stringify(input.blockers),
          JSON.stringify(input.warnings),
          JSON.stringify(input.snapshot),
          input.note ?? null,
        );

      return {
        ...input,
        id: Number(insertion.lastInsertRowid),
        recordedAt,
      };
    } finally {
      database.close();
    }
  }

  getScenario(id: number): JournalScenarioRecord | null {
    const database = this.open();

    try {
      const row = database.prepare('SELECT * FROM scenario_journal WHERE id = ?').get(id) as
        | JournalRow
        | undefined;
      return row ? this.toRecord(row) : null;
    } finally {
      database.close();
    }
  }

  list(limit: number, strategy?: Strategy): JournalScenarioRecord[] {
    const database = this.open();

    try {
      const rows = strategy
        ? database
            .prepare(
              `SELECT * FROM scenario_journal
               WHERE strategy = ?
               ORDER BY id DESC
               LIMIT ?`,
            )
            .all(strategy, limit)
        : database
            .prepare(
              `SELECT * FROM scenario_journal
               ORDER BY id DESC
               LIMIT ?`,
            )
            .all(limit);

      return (rows as JournalRow[]).map((row) => this.toRecord(row));
    } finally {
      database.close();
    }
  }

  openPaperTrade(input: PaperTradeInput): PaperTradeRecord {
    const database = this.open();

    try {
      const existing = database
        .prepare('SELECT id FROM paper_trades WHERE scenario_id = ?')
        .get(input.scenarioId) as { id: number | bigint } | undefined;
      if (existing) {
        throw new Error('A paper trade already exists for this scenario');
      }

      const openedAt = new Date().toISOString();
      const insertion = database
        .prepare(
          `INSERT INTO paper_trades (
            scenario_id, status, strategy, instrument_id, side, lots, units, opened_at,
            entry_market_price, entry_fill_price, entry_commission_rub, entry_slippage_rub,
            commission_rate, slippage_rate
          ) VALUES (?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.scenarioId,
          input.strategy,
          input.instrumentId,
          input.side,
          input.lots,
          input.units,
          openedAt,
          input.entryMarketPrice,
          input.entryFillPrice,
          input.entryCommissionRub,
          input.entrySlippageRub,
          input.commissionRate,
          input.slippageRate,
        );

      return {
        ...input,
        id: Number(insertion.lastInsertRowid),
        status: 'open',
        openedAt,
      };
    } finally {
      database.close();
    }
  }

  getPaperTrade(id: number): PaperTradeRecord | null {
    const database = this.open();

    try {
      const row = database.prepare('SELECT * FROM paper_trades WHERE id = ?').get(id) as
        | PaperTradeRow
        | undefined;
      return row ? this.toPaperTrade(row) : null;
    } finally {
      database.close();
    }
  }

  listPaperTrades(limit: number, status?: PaperTradeStatus): PaperTradeRecord[] {
    const database = this.open();

    try {
      const rows = status
        ? database
            .prepare(
              `SELECT * FROM paper_trades
               WHERE status = ?
               ORDER BY id DESC
               LIMIT ?`,
            )
            .all(status, limit)
        : database
            .prepare(
              `SELECT * FROM paper_trades
               ORDER BY id DESC
               LIMIT ?`,
            )
            .all(limit);

      return (rows as PaperTradeRow[]).map((row) => this.toPaperTrade(row));
    } finally {
      database.close();
    }
  }

  listClosedPaperTrades(
    from: string,
    to: string,
    strategy?: Strategy,
  ): PaperTradeRecord[] {
    const database = this.open();

    try {
      const rows = strategy
        ? database
            .prepare(
              `SELECT * FROM paper_trades
               WHERE status = 'closed'
                 AND strategy = ?
                 AND closed_at >= ?
                 AND closed_at < ?
               ORDER BY closed_at DESC`,
            )
            .all(strategy, from, to)
        : database
            .prepare(
              `SELECT * FROM paper_trades
               WHERE status = 'closed'
                 AND closed_at >= ?
                 AND closed_at < ?
               ORDER BY closed_at DESC`,
            )
            .all(from, to);

      return (rows as PaperTradeRow[]).map((row) => this.toPaperTrade(row));
    } finally {
      database.close();
    }
  }

  closePaperTrade(input: PaperTradeCloseInput): PaperTradeRecord {
    const database = this.open();

    try {
      const trade = database.prepare('SELECT * FROM paper_trades WHERE id = ?').get(input.id) as
        | PaperTradeRow
        | undefined;
      if (!trade) throw new Error('Paper trade was not found');
      if (trade.status !== 'open') throw new Error('Paper trade is already closed');

      database
        .prepare(
          `UPDATE paper_trades
           SET status = 'closed',
               closed_at = ?,
               exit_market_price = ?,
               exit_fill_price = ?,
               exit_commission_rub = ?,
               exit_slippage_rub = ?,
               gross_pnl_rub = ?,
               total_commission_rub = ?,
               total_slippage_rub = ?,
               net_pnl_rub = ?,
               close_note = ?
           WHERE id = ?`,
        )
        .run(
          new Date().toISOString(),
          input.exitMarketPrice,
          input.exitFillPrice,
          input.exitCommissionRub,
          input.exitSlippageRub,
          input.grossPnlRub,
          input.totalCommissionRub,
          input.totalSlippageRub,
          input.netPnlRub,
          input.closeNote ?? null,
          input.id,
        );

      const updated = database.prepare('SELECT * FROM paper_trades WHERE id = ?').get(input.id) as PaperTradeRow;
      return this.toPaperTrade(updated);
    } finally {
      database.close();
    }
  }

  private open(): DatabaseSync {
    const directory = dirname(this.databasePath);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    chmodSync(directory, 0o700);

    const database = new DatabaseSync(this.databasePath);
    chmodSync(this.databasePath, 0o600);
    database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    database.exec(schema);
    return database;
  }

  private toRecord(row: JournalRow): JournalScenarioRecord {
    return {
      id: Number(row.id),
      recordedAt: row.recorded_at,
      observedAt: row.observed_at,
      strategy: row.strategy,
      instrumentId: row.instrument_id,
      input: {
        side: row.side,
        entryPrice: row.entry_price,
        stopPrice: row.stop_price,
        targetPrice: row.target_price,
        lotSize: row.lot_size,
        slippageRate: row.slippage_rate,
      },
      decision: row.decision,
      blockers: parseStringArray(row.blockers_json),
      warnings: parseStringArray(row.warnings_json),
      snapshot: parseJson<unknown>(row.snapshot_json, {}),
      ...(row.note ? { note: row.note } : {}),
    };
  }

  private toPaperTrade(row: PaperTradeRow): PaperTradeRecord {
    return {
      id: Number(row.id),
      scenarioId: Number(row.scenario_id),
      status: row.status,
      strategy: row.strategy,
      instrumentId: row.instrument_id,
      side: row.side,
      lots: row.lots,
      units: row.units,
      openedAt: row.opened_at,
      entryMarketPrice: row.entry_market_price,
      entryFillPrice: row.entry_fill_price,
      entryCommissionRub: row.entry_commission_rub,
      entrySlippageRub: row.entry_slippage_rub,
      commissionRate: row.commission_rate,
      slippageRate: row.slippage_rate,
      ...(row.closed_at ? { closedAt: row.closed_at } : {}),
      ...(row.exit_market_price !== null ? { exitMarketPrice: row.exit_market_price } : {}),
      ...(row.exit_fill_price !== null ? { exitFillPrice: row.exit_fill_price } : {}),
      ...(row.exit_commission_rub !== null ? { exitCommissionRub: row.exit_commission_rub } : {}),
      ...(row.exit_slippage_rub !== null ? { exitSlippageRub: row.exit_slippage_rub } : {}),
      ...(row.gross_pnl_rub !== null ? { grossPnlRub: row.gross_pnl_rub } : {}),
      ...(row.total_commission_rub !== null ? { totalCommissionRub: row.total_commission_rub } : {}),
      ...(row.total_slippage_rub !== null ? { totalSlippageRub: row.total_slippage_rub } : {}),
      ...(row.net_pnl_rub !== null ? { netPnlRub: row.net_pnl_rub } : {}),
      ...(row.close_note ? { closeNote: row.close_note } : {}),
    };
  }
}
