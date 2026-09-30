import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { ExecutionMode, Strategy } from '../config.js';
import { riskBudgetFits } from '../execution/live-pilot-risk.js';
import { assertSnapshotProgress, type SandboxOrderSnapshot } from '../execution/sandbox-order-state.js';
import { decimalPriceNano, type SandboxStopIntent, type SandboxStopObservation } from '../execution/sandbox-stop-state.js';
import { analyzeSandboxRoundTrip } from '../execution/sandbox-round-trip.js';

export type NativeStopRecord = { intent: SandboxStopIntent; observation: SandboxStopObservation | null };
export type SandboxExitEvidence = { snapshot: SandboxOrderSnapshot; flatConfirmedAt: string | null; observedAt: string };

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

  CREATE TABLE IF NOT EXISTS execution_evidence (
    execution_order_id INTEGER PRIMARY KEY REFERENCES execution_orders(id),
    lots_executed INTEGER NOT NULL CHECK(lots_executed >= 0),
    snapshot_json TEXT,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS native_stop_intents (
    scenario_id INTEGER PRIMARY KEY REFERENCES scenario_journal(id),
    request_id TEXT NOT NULL UNIQUE,
    intent_json TEXT NOT NULL,
    observation_json TEXT,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS sandbox_exit_evidence (
    scenario_id INTEGER PRIMARY KEY REFERENCES scenario_journal(id),
    snapshot_json TEXT NOT NULL,
    flat_confirmed_at TEXT,
    observed_at TEXT NOT NULL
  ) STRICT;
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

  listRecoverableExecutionOrders(limit: number): ExecutionOrderRecord[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 51) throw new Error('Invalid reconciliation batch size');
    const database = this.open();
    try {
      return (database.prepare("SELECT * FROM execution_orders WHERE mode = 'sandbox' AND status IN ('submitting', 'accepted') ORDER BY id ASC LIMIT ?")
        .all(limit) as ExecutionOrderRow[]).map(row => this.toExecutionOrder(row));
    } finally { database.close(); }
  }

  claimExecution(scenarioId: number, chatId: string, limits?: {
    from: string; to: string; now: string; maxOrders: number; maxRiskRub: number; singlePosition?: boolean;
  }): ExecutionOrderRecord {
    const database = this.open();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as ExecutionOrderRow | undefined;
      if (!row) throw new Error('Execution order was not found');

      if (row.status === 'pending') {
        if (limits) {
          const killed = database.prepare('SELECT value FROM runtime_state WHERE key = ?')
            .get('execution.kill_switch') as { value: string } | undefined;
          if (killed?.value !== 'false') throw new Error('Execution kill switch is active');
          if (limits.singlePosition && database.prepare(
            "SELECT id FROM execution_orders WHERE status IN ('submitting', 'accepted') LIMIT 1",
          ).get()) throw new Error('Pilot already has an unresolved order or open position');
          const reservations = this.executionReservations(database, limits.from, limits.to);
          if (reservations.length >= limits.maxOrders) throw new Error('Daily execution order limit has been reached');
          if (!riskBudgetFits(reservations, row.estimated_risk_rub, limits.maxRiskRub)) {
            throw new Error('Daily execution risk limit would be exceeded');
          }
        }
        const now = limits?.now ?? new Date().toISOString();
        database
          .prepare(
            `UPDATE execution_orders
             SET status = 'submitting', approved_by_chat_id = ?, updated_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .run(chatId, now, row.id);
        this.appendExecutionEvent(database, Number(row.id), 'approved', { chatId }, now);
      } else {
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

  markExecutionAccepted(scenarioId: number, brokerOrderId: string, detail: string, lotsExecuted = 0): ExecutionOrderRecord {
    return this.finishExecution(scenarioId, 'accepted', brokerOrderId, detail, 'broker_accepted', lotsExecuted);
  }

  getExecutionSnapshot(scenarioId: number): SandboxOrderSnapshot | null {
    const database = this.open();
    try {
      const row = database.prepare(`SELECT e.snapshot_json AS snapshot FROM execution_evidence e
        JOIN execution_orders o ON o.id = e.execution_order_id WHERE o.scenario_id = ?`).get(scenarioId) as
        { snapshot: string | null } | undefined;
      return row?.snapshot ? JSON.parse(row.snapshot) as SandboxOrderSnapshot : null;
    } finally { database.close(); }
  }

  getNativeStop(scenarioId: number): NativeStopRecord | null {
    const db = this.open();
    try {
      const row = db.prepare('SELECT intent_json, observation_json FROM native_stop_intents WHERE scenario_id = ?').get(scenarioId) as
        { intent_json: string; observation_json: string | null } | undefined;
      return row ? { intent: JSON.parse(row.intent_json) as SandboxStopIntent,
        observation: row.observation_json ? JSON.parse(row.observation_json) as SandboxStopObservation : null } : null;
    } finally { db.close(); }
  }

  claimNativeStop(intent: SandboxStopIntent): { claimed: boolean; record: NativeStopRecord } {
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      const prior = db.prepare('SELECT intent_json, observation_json FROM native_stop_intents WHERE scenario_id = ?').get(intent.scenarioId) as
        { intent_json: string; observation_json: string | null } | undefined;
      if (prior) {
        const persisted = JSON.parse(prior.intent_json) as SandboxStopIntent;
        if (persisted.accountId !== intent.accountId || persisted.instrumentId !== intent.instrumentId
          || persisted.entryRequestId !== intent.entryRequestId || persisted.lots !== intent.lots
          || persisted.stopNano !== intent.stopNano || persisted.limitNano !== intent.limitNano) throw new Error('Stop intent contradicts earlier evidence');
        db.exec('COMMIT');
        return { claimed: false, record: { intent: persisted,
          observation: prior.observation_json ? JSON.parse(prior.observation_json) as SandboxStopObservation : null } };
      }
      const row = db.prepare(`SELECT o.*, s.stop_price AS planned_stop FROM execution_orders o
        JOIN scenario_journal s ON s.id = o.scenario_id WHERE o.scenario_id = ?`).get(intent.scenarioId) as
        (ExecutionOrderRow & { planned_stop: number }) | undefined;
      const evidence = db.prepare(`SELECT e.snapshot_json FROM execution_evidence e
        JOIN execution_orders o ON o.id = e.execution_order_id WHERE o.scenario_id = ?`).get(intent.scenarioId) as
        { snapshot_json: string | null } | undefined;
      const snapshot = evidence?.snapshot_json ? JSON.parse(evidence.snapshot_json) as SandboxOrderSnapshot : null;
      if (!row || row.mode !== 'sandbox' || row.side !== 'long' || row.status !== 'accepted' || !row.approved_by_chat_id
        || !snapshot?.terminal || snapshot.lotsExecuted <= 0 || snapshot.lotsExecuted !== intent.lots
        || row.instrument_id !== intent.instrumentId || row.order_request_id !== intent.entryRequestId
        || intent.brokerStopId !== null || intent.stopNano !== decimalPriceNano(row.planned_stop)
        || intent.limitNano !== intent.stopNano) throw new Error('Stop requires confirmed terminal fills for an approved sandbox entry');
      db.prepare('INSERT INTO native_stop_intents (scenario_id, request_id, intent_json, updated_at) VALUES (?, ?, ?, ?)')
        .run(intent.scenarioId, intent.requestId, JSON.stringify(intent), intent.createdAt);
      this.appendExecutionEvent(db, Number(row.id), 'native_stop_claimed', { requestId: intent.requestId, lots: intent.lots }, intent.createdAt);
      db.exec('COMMIT'); return { claimed: true, record: { intent, observation: null } };
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  }

  acknowledgeNativeStop(scenarioId: number, requestId: string, brokerStopId: string): void {
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db.prepare('SELECT intent_json FROM native_stop_intents WHERE scenario_id = ?').get(scenarioId) as { intent_json: string } | undefined;
      if (!row) throw new Error('Stop intent was not found');
      const intent = JSON.parse(row.intent_json) as SandboxStopIntent;
      if (intent.requestId !== requestId || intent.brokerStopId !== null || !brokerStopId || brokerStopId.length > 256
        || /[\u0000-\u001f\u007f]/.test(brokerStopId)) throw new Error('Stop acknowledgement contradicts earlier evidence');
      intent.brokerStopId = brokerStopId;
      db.prepare('UPDATE native_stop_intents SET intent_json = ?, updated_at = ? WHERE scenario_id = ?')
        .run(JSON.stringify(intent), new Date().toISOString(), scenarioId);
      const entry = db.prepare('SELECT id FROM execution_orders WHERE scenario_id = ?').get(scenarioId) as { id: number };
      this.appendExecutionEvent(db, entry.id, 'native_stop_acknowledged', { requestId, brokerStopId });
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  }

  observeNativeStop(scenarioId: number, observation: SandboxStopObservation): void {
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db.prepare('SELECT intent_json, observation_json FROM native_stop_intents WHERE scenario_id = ?').get(scenarioId) as
        { intent_json: string; observation_json: string | null } | undefined;
      if (!row || !(JSON.parse(row.intent_json) as SandboxStopIntent).brokerStopId) throw new Error('Stop acknowledgement is missing');
      const prior = row.observation_json ? JSON.parse(row.observation_json) as SandboxStopObservation : null;
      if (prior && ((prior.status !== 'STOP_ORDER_STATUS_ACTIVE' && observation.status !== prior.status)
        || (prior.childOrderId && prior.childOrderId !== observation.childOrderId))) throw new Error('Stop observation contradicts earlier evidence');
      db.prepare('UPDATE native_stop_intents SET observation_json = ?, updated_at = ? WHERE scenario_id = ?')
        .run(JSON.stringify(observation), new Date().toISOString(), scenarioId);
      const entry = db.prepare('SELECT id FROM execution_orders WHERE scenario_id = ?').get(scenarioId) as { id: number };
      this.appendExecutionEvent(db, entry.id, 'native_stop_observed', observation);
      db.exec('COMMIT');
    } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
    finally { db.close(); }
  }

  getSandboxExitEvidence(scenarioId: number): SandboxExitEvidence | null {
    const db = this.open();
    try {
      const row = db.prepare('SELECT snapshot_json, flat_confirmed_at, observed_at FROM sandbox_exit_evidence WHERE scenario_id = ?').get(scenarioId) as
        { snapshot_json: string; flat_confirmed_at: string | null; observed_at: string } | undefined;
      return row ? { snapshot: JSON.parse(row.snapshot_json) as SandboxOrderSnapshot,
        flatConfirmedAt: row.flat_confirmed_at, observedAt: row.observed_at } : null;
    } finally { db.close(); }
  }

  recordSandboxExitEvidence(scenarioId: number, exit: SandboxOrderSnapshot, flatConfirmedAt: string | null, now = new Date()) {
    const db = this.open();
    try {
      db.exec('BEGIN IMMEDIATE');
      const row = db.prepare(`SELECT o.id, o.mode, o.status, o.approved_by_chat_id, s.lot_size, e.snapshot_json AS entry_json,
        n.intent_json, n.observation_json FROM execution_orders o
        JOIN scenario_journal s ON s.id = o.scenario_id JOIN execution_evidence e ON e.execution_order_id = o.id
        JOIN native_stop_intents n ON n.scenario_id = o.scenario_id WHERE o.scenario_id = ?`).get(scenarioId) as
        { id: number; mode: string; status: string; approved_by_chat_id: string | null; lot_size: number; entry_json: string | null;
          intent_json: string; observation_json: string | null } | undefined;
      if (!row || row.mode !== 'sandbox' || row.status !== 'accepted' || !row.approved_by_chat_id || !row.entry_json || !row.observation_json) throw new Error();
      const entry = JSON.parse(row.entry_json) as SandboxOrderSnapshot;
      const intent = JSON.parse(row.intent_json) as SandboxStopIntent;
      const stop = JSON.parse(row.observation_json) as SandboxStopObservation;
      if (!intent.brokerStopId || stop.status !== 'STOP_ORDER_STATUS_EXECUTED' || stop.childOrderId !== exit.brokerOrderId
        || intent.lots !== entry.lotsExecuted || !Number.isFinite(now.getTime())) throw new Error();
      const result = analyzeSandboxRoundTrip(entry, exit, row.lot_size);
      if (flatConfirmedAt !== null && (!result.fullySold || !Number.isFinite(Date.parse(flatConfirmedAt))
        || Date.parse(flatConfirmedAt) < Date.parse(result.closedAt!) || Date.parse(flatConfirmedAt) > now.getTime() + 60_000)) throw new Error();
      const prior = db.prepare('SELECT snapshot_json FROM sandbox_exit_evidence WHERE scenario_id = ?').get(scenarioId) as { snapshot_json: string } | undefined;
      if (prior) assertSnapshotProgress(JSON.parse(prior.snapshot_json) as SandboxOrderSnapshot, exit);
      const serialized = JSON.stringify(exit);
      db.prepare(`INSERT INTO sandbox_exit_evidence (scenario_id, snapshot_json, flat_confirmed_at, observed_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(scenario_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, flat_confirmed_at=excluded.flat_confirmed_at,
        observed_at=excluded.observed_at`).run(scenarioId, serialized, flatConfirmedAt, now.toISOString());
      if (!prior || prior.snapshot_json !== serialized) this.appendExecutionEvent(db, row.id, 'sandbox_exit_reconciled', {
        executionStatus: exit.executionStatus, lotsExecuted: exit.lotsExecuted, grossNano: exit.grossNano, commissionNano: exit.commissionNano,
      }, now.toISOString());
      db.exec('COMMIT');
      return { ...result, flatConfirmedAt, observedAt: now.toISOString(), complete: result.fullySold && result.netPnlNano !== null && flatConfirmedAt !== null };
    } catch { try { db.exec('ROLLBACK'); } catch {} throw new Error('Sandbox exit contradicts the approved stop or earlier evidence'); }
    finally { db.close(); }
  }

  listSandboxResults(limit = 5) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid sandbox result limit');
    const db = this.open();
    try {
      const rows = db.prepare(`SELECT x.scenario_id, x.snapshot_json AS exit_json, x.flat_confirmed_at, x.observed_at,
        e.snapshot_json AS entry_json, s.lot_size FROM sandbox_exit_evidence x
        JOIN execution_orders o ON o.scenario_id=x.scenario_id JOIN execution_evidence e ON e.execution_order_id=o.id
        JOIN scenario_journal s ON s.id=x.scenario_id WHERE o.mode='sandbox' ORDER BY x.observed_at DESC LIMIT ?`).all(limit) as
        Array<{ scenario_id: number; exit_json: string; entry_json: string; lot_size: number; flat_confirmed_at: string | null; observed_at: string }>;
      return rows.map(row => {
        const result = analyzeSandboxRoundTrip(JSON.parse(row.entry_json) as SandboxOrderSnapshot, JSON.parse(row.exit_json) as SandboxOrderSnapshot, row.lot_size);
        return { scenarioId: row.scenario_id, ...result, flatConfirmedAt: row.flat_confirmed_at, observedAt: row.observed_at,
          complete: result.fullySold && result.netPnlNano !== null && row.flat_confirmed_at !== null };
      });
    } finally { db.close(); }
  }

  recordExecutionReconciliation(scenarioId: number, snapshot: SandboxOrderSnapshot): ExecutionOrderRecord {
    const database = this.open();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database.prepare('SELECT * FROM execution_orders WHERE scenario_id = ?').get(scenarioId) as ExecutionOrderRow | undefined;
      if (!row || !['submitting', 'accepted'].includes(row.status)) throw new Error('Only an unresolved or accepted order can be reconciled');
      const evidence = database.prepare('SELECT lots_executed, snapshot_json FROM execution_evidence WHERE execution_order_id = ?')
        .get(row.id) as { lots_executed: number; snapshot_json: string | null } | undefined;
      // Legacy accepted rows did not persist a fill count. A zero-fill reply
      // cannot erase a possible position merely because that evidence is absent.
      if (row.status === 'accepted' && !evidence && snapshot.lotsExecuted === 0) {
        throw new Error('Legacy accepted order requires independent position evidence');
      }
      if (snapshot.lotsExecuted > row.lots || snapshot.lotsExecuted < (evidence?.lots_executed ?? 0)
        || (row.broker_order_id && row.broker_order_id !== snapshot.brokerOrderId)) {
        throw new Error('Sandbox reconciliation contradicts earlier execution evidence');
      }
      if (evidence?.snapshot_json) assertSnapshotProgress(JSON.parse(evidence.snapshot_json) as SandboxOrderSnapshot, snapshot);
      const status = snapshot.terminal && snapshot.lotsExecuted === 0 ? 'failed' : 'accepted';
      const now = new Date().toISOString();
      const detail = `${snapshot.executionStatus}; reconciled lots ${snapshot.lotsExecuted}/${row.lots}`;
      database.prepare('UPDATE execution_orders SET status = ?, broker_order_id = ?, detail = ?, updated_at = ? WHERE id = ?')
        .run(status, snapshot.brokerOrderId, detail, now, row.id);
      database.prepare(`INSERT INTO execution_evidence (execution_order_id, lots_executed, snapshot_json, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(execution_order_id) DO UPDATE SET
        lots_executed = excluded.lots_executed, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`)
        .run(row.id, snapshot.lotsExecuted, JSON.stringify(snapshot), now);
      this.appendExecutionEvent(database, Number(row.id), 'broker_reconciled', {
        executionStatus: snapshot.executionStatus, lotsExecuted: snapshot.lotsExecuted,
        grossNano: snapshot.grossNano, commissionNano: snapshot.commissionNano,
      }, now);
      database.exec('COMMIT');
      return this.toExecutionOrder(database.prepare('SELECT * FROM execution_orders WHERE id = ?').get(row.id) as ExecutionOrderRow);
    } catch (error: unknown) {
      try { database.exec('ROLLBACK'); } catch { /* Keep all prior evidence on failure. */ }
      throw error;
    } finally { database.close(); }
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
      const reservations = this.executionReservations(database, from, to);
      return { orderCount: reservations.length, riskRub: reservations.reduce((sum, risk) => sum + risk, 0) };
    } finally {
      database.close();
    }
  }

  private executionReservations(database: DatabaseSync, from: string, to: string): number[] {
    // Approval time is immutable: a broker reply/retry after midnight must not
    // move already consumed risk into a different Moscow calendar day.
    const rows = database.prepare(`SELECT o.estimated_risk_rub AS risk
      FROM execution_orders o JOIN (
        SELECT execution_order_id, MIN(created_at) AS approved_at FROM execution_events
        WHERE event_type = 'approved' GROUP BY execution_order_id
      ) e ON e.execution_order_id = o.id
      WHERE e.approved_at >= ? AND e.approved_at < ? AND o.status IN ('submitting', 'accepted')`)
      .all(from, to) as Array<{ risk: number }>;
    return rows.map(row => row.risk);
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
    lotsExecuted = 0,
  ): ExecutionOrderRecord {
    const database = this.open();
    try {
      database.exec('BEGIN IMMEDIATE');
      const row = database
        .prepare('SELECT * FROM execution_orders WHERE scenario_id = ?')
        .get(scenarioId) as ExecutionOrderRow | undefined;
      if (!row) throw new Error('Execution order was not found');
      if (row.status !== 'submitting') throw new Error(`Execution order is already ${row.status}`);
      if (!Number.isSafeInteger(lotsExecuted) || lotsExecuted < 0 || lotsExecuted > row.lots) throw new Error('Invalid executed lot quantity');

      const now = new Date().toISOString();
      database
        .prepare(
          `UPDATE execution_orders
           SET status = ?, broker_order_id = ?, detail = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(status, brokerOrderId, detail.slice(0, 500), now, row.id);
      if (status === 'accepted') database.prepare(`INSERT INTO execution_evidence (execution_order_id, lots_executed, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(execution_order_id) DO UPDATE SET lots_executed = MAX(lots_executed, excluded.lots_executed),
        updated_at = excluded.updated_at`).run(row.id, lotsExecuted, now);
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
    createdAt = new Date().toISOString(),
  ): void {
    database
      .prepare(
        `INSERT INTO execution_events (execution_order_id, event_type, created_at, detail_json)
         VALUES (?, ?, ?, ?)`,
      )
      .run(executionOrderId, eventType, createdAt, JSON.stringify(detail));
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
