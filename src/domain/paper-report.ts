import { roundMoney } from './money.js';

export type ClosedPaperTradeForReport = {
  status: 'closed';
  grossPnlRub: number;
  totalCommissionRub: number;
  totalSlippageRub: number;
  netPnlRub: number;
};

export type PaperTradeReport = {
  closedTrades: number;
  profitableTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRatePct: number | null;
  grossPnlRub: number;
  totalCommissionRub: number;
  totalSlippageRub: number;
  netPnlRub: number;
  averageNetPnlRub: number | null;
  profitFactor: number | null;
  warnings: string[];
};

function percent(value: number) {
  return Math.round(value * 100) / 100;
}

export function summarizePaperTrades(trades: ClosedPaperTradeForReport[]): PaperTradeReport {
  const profitableTrades = trades.filter((trade) => trade.netPnlRub > 0);
  const losingTrades = trades.filter((trade) => trade.netPnlRub < 0);
  const breakevenTrades = trades.filter((trade) => trade.netPnlRub === 0);
  const sum = (selector: (trade: ClosedPaperTradeForReport) => number) =>
    trades.reduce((total, trade) => total + selector(trade), 0);
  const grossProfit = profitableTrades.reduce((total, trade) => total + trade.netPnlRub, 0);
  const grossLoss = Math.abs(losingTrades.reduce((total, trade) => total + trade.netPnlRub, 0));
  const closedTrades = trades.length;
  const warnings: string[] = [];

  if (closedTrades === 0) {
    warnings.push('No closed paper trades in the selected period');
  } else if (closedTrades < 20) {
    warnings.push('Fewer than 20 closed paper trades: the sample is too small for a strategy conclusion');
  }

  return {
    closedTrades,
    profitableTrades: profitableTrades.length,
    losingTrades: losingTrades.length,
    breakevenTrades: breakevenTrades.length,
    winRatePct: closedTrades === 0 ? null : percent((profitableTrades.length / closedTrades) * 100),
    grossPnlRub: roundMoney(sum((trade) => trade.grossPnlRub)),
    totalCommissionRub: roundMoney(sum((trade) => trade.totalCommissionRub)),
    totalSlippageRub: roundMoney(sum((trade) => trade.totalSlippageRub)),
    netPnlRub: roundMoney(sum((trade) => trade.netPnlRub)),
    averageNetPnlRub: closedTrades === 0 ? null : roundMoney(sum((trade) => trade.netPnlRub) / closedTrades),
    profitFactor: grossLoss === 0 ? null : percent(grossProfit / grossLoss),
    warnings,
  };
}
