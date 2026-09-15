import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ExecutionMode, Strategy } from '../config.js';

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

export type ExecutionOrderStatus =
  | 'pending'
  | 'rejected'
  | 'submitting'
  | 'accepted'
  | 'failed';

export type ExecutionOrderRecord = {
  id: number;
  scenarioId: number;
  mode: ExecutionMode;
  status: ExecutionOrderStatus;
  instrumentId: string;
  side: 'long' | 'short';
  lots: number;
  limitPrice: number;
  estimatedRiskRub: number;
  orderRequestId: string;
  brokerOrderId?: string;
  approvedByChatId?: string;
  createdAt: string;
  updatedAt: string;
  detail?: string;
};

export type ExecutionOrderInput = Omit<
  ExecutionOrderRecord,
  'id' | 'status' | 'brokerOrderId' | 'approvedByChatId' | 'createdAt' | 'updatedAt' | 'detail'
>;

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

type ExecutionOrderRow = {
  id: number | bigint;
  scenario_id: number | bigint;
  mode: ExecutionMode;
  status: ExecutionOrderStatus;
  instrument_id: string;
  side: 'long' | 'short';
  lots: number;
  limit_price: number;
  estimated_risk_rub: number;
  order_request_id: string;
  broker_order_id: string | null;
  approved_by_chat_id: string | null;
  created_at: string;
  updated_at: string;
  detail: string | null;
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

  CREATE TABLE IF NOT EXISTS runtime_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS execution_orders (
    id INTEGER PRIMARY KEY,
    scenario_id INTEGER NOT NULL UNIQUE REFERENCES scenario_journal(id),
    mode TEXT NOT NULL CHECK(mode IN ('disabled', 'sandbox')),
    status TEXT NOT NULL CHECK(status IN ('pending', 'rejected', 'submitting', 'accepted', 'failed')),
    instrument_id TEXT NOT NULL,
    side TEXT NOT NULL CHECK(side IN ('long', 'short')),
    lots INTEGER NOT NULL CHECK(lots > 0),
    limit_price REAL NOT NULL CHECK(limit_price > 0),
    estimated_risk_rub REAL NOT NULL CHECK(estimated_risk_rub > 0),
    order_request_id TEXT NOT NULL UNIQUE,
    broker_order_id TEXT,
    approved_by_chat_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    detail TEXT
  ) STRICT;

  CREATE INDEX IF NOT EXISTS execution_orders_updated_at
    ON execution_orders(updated_at DESC);

  CREATE TABLE IF NOT EXISTS execution_events (
    id INTEGER PRIMARY KEY,
    execution_order_id INTEGER NOT NULL REFERENCES execution_orders(id),
    event_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    detail_json TEXT NOT NULL
  ) STRICT;

  CREATE INDEX IF NOT EXISTS execution_events_order_created
    ON execution_events(execution_order_id, created_at ASC);
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

  hasRecentCandidate(input: {
    strategy: Strategy;
    instrumentId: string;
    since: string;
  }): boolean {
    const database = this.open();

    try {
      const row = database
        .prepare(
          `SELECT id FROM scenario_journal
           WHERE strategy = ?
             AND instrument_id = ?
             AND decision = 'candidate'
             AND recorded_at >= ?
           ORDER BY id DESC
           LIMIT 1`,
        )
        .get(input.strategy, input.instrumentId, input.since) as { id: number | bigint } | undefined;
      return Boolean(row);
    } finally {
      database.close();
    }
  }

  getRuntimeState(key: string): string | null {
    const database = this.open();

    try {
      const row = database.prepare('SELECT value FROM runtime_state WHERE key = ?').get(key) as
        | { value: string }
        | undefined;
      return row?.value ?? null;
    } finally {
      database.close();
    }
  }

  setRuntimeState(key: string, value: string): void {
    const database = this.open();

    try {
      database
        .prepare(
          `INSERT INTO runtime_state (key, value, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .run(key, value, new Date().toISOString());
    } finally {
      database.close();
    }
  }

  isScannerPaused(strategy: Strategy): boolean {
    return this.getRuntimeState(`scanner.${strategy}.paused`) === 'true';
  }

  setScannerPaused(strategy: Strategy, paused: boolean): void {
    this.setRuntimeState(`scanner.${strategy}.paused`, paused ? 'true' : 'false');
  }

  getTelegramUpdateOffset(): number {
    const raw = this.getRuntimeState('telegram.update_offset');
    if (!raw) return 0;

    const offset = Number.parseInt(raw, 10);
    return Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  }

  setTelegramUpdateOffset(offset: number): void {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('Telegram update offset must be a non-negative safe integer');
    }
    this.setRuntimeState('telegram.update_offset', String(offset));
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

  queueExecution(input: ExecutionOrderInput): ExecutionOrderRecord {
    const database = this.open();

    try {
      database.exec('BEGIN IMMEDIATE');
      const existing = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(input.scenarioId) as ExecutionOrderRow | undefined;
      if (existing) {
        database.exec('COMMIT');
        return this.toExecutionOrder(existing);
      }

      const now = new Date().toISOString();
      const insertion = database
        .prepare(
          `INSERT INTO execution_orders (
            scenario_id, mode, status, instrument_id, side, lots, limit_price,
            estimated_risk_rub, order_request_id, created_at, updated_at
          ) VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.scenarioId,
          input.mode,
          input.instrumentId,
          input.side,
          input.lots,
          input.limitPrice,
          input.estimatedRiskRub,
          input.orderRequestId,
          now,
          now,
        );
      const id = Number(insertion.lastInsertRowid);
      this.appendExecutionEvent(database, id, 'queued', { mode: input.mode });
      database.exec('COMMIT');

      const row = database.prepare('SELECT * FROM execution_orders WHERE id = ?').get(id) as ExecutionOrderRow;
      return this.toExecutionOrder(row);
    } catch (error: unknown) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Transaction may already be committed.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  getExecutionByScenario(scenarioId: number): ExecutionOrderRecord | null {
    const database = this.open();
    try {
      const row = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as ExecutionOrderRow | undefined;
      return row ? this.toExecutionOrder(row) : null;
    } finally {
      database.close();
    }
  }

  listExecutionOrders(limit: number): ExecutionOrderRecord[] {
    const database = this.open();
    try {
      const rows = database
        .prepare('SELECT * FROM execution_orders ORDER BY id DESC LIMIT ?')
        .all(limit) as ExecutionOrderRow[];
      return rows.map((row) => this.toExecutionOrder(row));
    } finally {
      database.close();
    }
  }

  claimExecution(scenarioId: number, chatId: string): ExecutionOrderRecord {
    const database = this.open();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as ExecutionOrderRow | undefined;
      if (!row) throw new Error('Execution order was not found');

      if (row.status === 'pending') {
        const now = new Date().toISOString();
        database
          .prepare(
            `UPDATE execution_orders
             SET status = 'submitting', approved_by_chat_id = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(chatId, now, row.id);
        this.appendExecutionEvent(database, Number(row.id), 'approved', { chatId });
      } else if (row.status !== 'submitting') {
        throw new Error(`Execution order is already ${row.status}`);
      }

      database.exec('COMMIT');
      const claimed = database.prepare('SELECT * FROM execution_orders WHERE id = ?').get(row.id) as ExecutionOrderRow;
      return this.toExecutionOrder(claimed);
    } catch (error: unknown) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Transaction may already be committed.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  rejectExecution(scenarioId: number, chatId: string): ExecutionOrderRecord {
    const database = this.open();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as ExecutionOrderRow | undefined;
      if (!row) throw new Error('Execution order was not found');
      if (row.status !== 'pending') throw new Error(`Execution order is already ${row.status}`);

      const now = new Date().toISOString();
      database
        .prepare(
          `UPDATE execution_orders
           SET status = 'rejected', approved_by_chat_id = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(chatId, now, row.id);
      this.appendExecutionEvent(database, Number(row.id), 'rejected', { chatId });
      database.exec('COMMIT');

      const rejected = database.prepare('SELECT * FROM execution_orders WHERE id = ?').get(row.id) as ExecutionOrderRow;
      return this.toExecutionOrder(rejected);
    } catch (error: unknown) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Transaction may already be committed.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  markExecutionAccepted(scenarioId: number, brokerOrderId: string, detail: string): ExecutionOrderRecord {
    return this.finishExecution(scenarioId, 'accepted', brokerOrderId, detail, 'broker_accepted');
  }

  markExecutionFailed(scenarioId: number, detail: string): ExecutionOrderRecord {
    return this.finishExecution(scenarioId, 'failed', null, detail, 'broker_rejected');
  }

  recordExecutionUncertain(scenarioId: number, detail: string): void {
    const database = this.open();
    try {
      const row = database
        .prepare('SELECT id FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as { id: number | bigint } | undefined;
      if (!row) throw new Error('Execution order was not found');
      this.appendExecutionEvent(database, Number(row.id), 'submission_uncertain', {
        detail: detail.slice(0, 500),
      });
    } finally {
      database.close();
    }
  }

  getExecutionDailyUsage(from: string, to: string): { orderCount: number; riskRub: number } {
    const database = this.open();
    try {
      const row = database
        .prepare(
          `SELECT COUNT(*) AS order_count, COALESCE(SUM(estimated_risk_rub), 0) AS risk_rub
           FROM execution_orders
           WHERE updated_at >= ? AND updated_at < ?
             AND status IN ('submitting', 'accepted')`,
        )
        .get(from, to) as { order_count: number | bigint; risk_rub: number };
      return { orderCount: Number(row.order_count), riskRub: row.risk_rub };
    } finally {
      database.close();
    }
  }

  isExecutionKilled(): boolean {
    return this.getRuntimeState('execution.kill_switch') !== 'false';
  }

  setExecutionKilled(killed: boolean): void {
    this.setRuntimeState('execution.kill_switch', killed ? 'true' : 'false');
  }

  private finishExecution(
    scenarioId: number,
    status: 'accepted' | 'failed',
    brokerOrderId: string | null,
    detail: string,
    eventType: string,
  ): ExecutionOrderRecord {
    const database = this.open();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as ExecutionOrderRow | undefined;
      if (!row) throw new Error('Execution order was not found');
      if (row.status !== 'submitting') throw new Error(`Execution order is already ${row.status}`);

      const now = new Date().toISOString();
      database
        .prepare(
          `UPDATE execution_orders
           SET status = ?, broker_order_id = ?, detail = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(status, brokerOrderId, detail.slice(0, 500), now, row.id);
      this.appendExecutionEvent(database, Number(row.id), eventType, {
        brokerOrderId,
        detail: detail.slice(0, 500),
      });
      database.exec('COMMIT');

      const finished = database.prepare('SELECT * FROM execution_orders WHERE id = ?').get(row.id) as ExecutionOrderRow;
      return this.toExecutionOrder(finished);
    } catch (error: unknown) {
      try {
        database.exec('ROLLBACK');
      } catch {
        // Transaction may already be committed.
      }
      throw error;
    } finally {
      database.close();
    }
  }

  private appendExecutionEvent(
    database: DatabaseSync,
    executionOrderId: number,
    eventType: string,
    detail: unknown,
  ): void {
    database
      .prepare(
        `INSERT INTO execution_events (execution_order_id, event_type, created_at, detail_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(executionOrderId, eventType, new Date().toISOString(), JSON.stringify(detail));
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

  private toExecutionOrder(row: ExecutionOrderRow): ExecutionOrderRecord {
    return {
      id: Number(row.id),
      scenarioId: Number(row.scenario_id),
      mode: row.mode,
      status: row.status,
      instrumentId: row.instrument_id,
      side: row.side,
      lots: row.lots,
      limitPrice: row.limit_price,
      estimatedRiskRub: row.estimated_risk_rub,
      orderRequestId: row.order_request_id,
      ...(row.broker_order_id ? { brokerOrderId: row.broker_order_id } : {}),
      ...(row.approved_by_chat_id ? { approvedByChatId: row.approved_by_chat_id } : {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.detail ? { detail: row.detail } : {}),
    };
  }
}
