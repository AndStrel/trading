export const TRADING_STRATEGY_IDS = [
  'trend-momentum-v1',
  'opening-range-breakout-v1',
  'vwap-reclaim-v1',
] as const;

export type TradingStrategyId = (typeof TRADING_STRATEGY_IDS)[number];

export type StrategyDescriptor = {
  id: TradingStrategyId;
  version: string;
  name: string;
  description: string;
  suitableRegime: string;
  rules: readonly string[];
  evidence: 'unvalidated';
};

export const STRATEGY_CATALOG: readonly StrategyDescriptor[] = [
  {
    id: 'trend-momentum-v1', version: '1', name: 'Тренд и объём',
    description: 'Восходящий пятиминутный тренд с подтверждением объёмом.',
    suitableRegime: 'Восходящий тренд',
    rules: ['SMA20 выше SMA50 более чем на 0,2%', 'Относительный объём не ниже 1',
      'Стоп от 1,5 ATR14; цель ограничена 5 ATR14 с учётом расходов'],
    evidence: 'unvalidated',
  },
  {
    id: 'opening-range-breakout-v1', version: '1', name: 'Пробой начального диапазона',
    description: 'Первое закрытие выше максимума первых шести свечей выбранного окна.',
    suitableRegime: 'Расширение диапазона с объёмом',
    rules: ['Диапазон: первые 30 минут настроенного окна, не универсальное открытие биржи',
      'Первый пробой закрытием в следующие 120 минут', 'Относительный объём не ниже 1',
      'Стоп 1,5 ATR14; цель 4 ATR14; чистое отношение доходности к риску не ниже 2'],
    evidence: 'unvalidated',
  },
  {
    id: 'vwap-reclaim-v1', version: '1', name: 'Возврат выше VWAP',
    description: 'Возврат закрытия выше средневзвешенной цены текущего окна при растущем VWAP.',
    suitableRegime: 'Восстановление цены и объёма',
    rules: ['Не менее 21 закрытой пятиминутной свечи текущего окна',
      'Предыдущее закрытие не выше VWAP, текущее выше растущего VWAP',
      'SMA20 не снижается; относительный объём не ниже 1',
      'Стоп 1,5 ATR14; цель 4 ATR14; чистое отношение доходности к риску не ниже 2'],
    evidence: 'unvalidated',
  },
];

export function isTradingStrategyId(value: unknown): value is TradingStrategyId {
  return typeof value === 'string' && TRADING_STRATEGY_IDS.some(id => id === value);
}

export function getStrategyDescriptor(id: TradingStrategyId): StrategyDescriptor {
  const descriptor = STRATEGY_CATALOG.find(strategy => strategy.id === id);
  if (!descriptor) throw new Error('Unknown trading strategy');
  return { ...descriptor, rules: [...descriptor.rules] };
}
