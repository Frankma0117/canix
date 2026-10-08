import { useEffect, useState } from 'react';
import type { UsageRow } from './types.ts';

/** How each logged operation (server: ai_usage.operation) is shown and what its units mean. */
export const OPERATIONS: Record<string, { label: string; unit: string; paid: boolean }> = {
  chat: { label: 'Conversación con IA', unit: 'tokens', paid: false },
  'voice.fish': { label: 'Notas de voz naturales', unit: 'caracteres', paid: true },
  'voice.fish.call': { label: 'Voz natural en llamadas', unit: 'caracteres', paid: true },
  'call.twilio': { label: 'Llamadas telefónicas', unit: 'llamadas', paid: true },
};

export function operationInfo(op: string) {
  return OPERATIONS[op] ?? { label: op.startsWith('fashion') ? 'Modo Fashion (IA)' : op, unit: 'tokens', paid: false };
}

/**
 * Editable price assumptions (USD) for the cost estimate - the real bill comes from each provider;
 * these only turn usage into an approximate number to decide what to charge later. Saved per browser.
 */
export interface Rates {
  tokenInPerM: number;
  tokenOutPerM: number;
  fishPerMChars: number;
  callEach: number;
}

export const DEFAULT_RATES: Rates = { tokenInPerM: 0.27, tokenOutPerM: 1.1, fishPerMChars: 15, callEach: 0.03 };
const RATES_KEY = 'canix_usage_rates';

export function useRates(): [Rates, (r: Rates) => void] {
  const [rates, setRates] = useState<Rates>(() => {
    try {
      return { ...DEFAULT_RATES, ...JSON.parse(localStorage.getItem(RATES_KEY) ?? '{}') };
    } catch {
      return DEFAULT_RATES;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(RATES_KEY, JSON.stringify(rates));
    } catch {
      /* not persisted - fine */
    }
  }, [rates]);
  return [rates, setRates];
}

export function estimateCost(row: Pick<UsageRow, 'operation' | 'uses' | 'input_units' | 'output_units'>, r: Rates): number {
  switch (row.operation) {
    case 'voice.fish':
    case 'voice.fish.call':
      return (row.input_units / 1e6) * r.fishPerMChars;
    case 'call.twilio':
      return row.uses * r.callEach;
    default:
      return (row.input_units / 1e6) * r.tokenInPerM + (row.output_units / 1e6) * r.tokenOutPerM;
  }
}

export function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.01) return '< $0.01';
  return `$${n.toFixed(2)}`;
}

export function compact(n: number): string {
  return new Intl.NumberFormat('es-CO', { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n);
}
