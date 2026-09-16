/**
 * Mercados de baixa conversão histórica (assertividade real medida nos bilhetes conferidos).
 * Usado para sinalizar risco crítico na UI. A tabela de taxas históricas agora é
 * definida em `ticket-rules.ts` (fonte única de verdade, também usada pelo robô).
 */
import { MARKET_HISTORIC_ACCURACY } from "./ticket-rules";

export const RISK_THRESHOLD = 0.2;

export function marketRisk(market: string): number | null {
  return MARKET_HISTORIC_ACCURACY[market] ?? null;
}

export function isRiskyMarket(market: string): boolean {
  const a = marketRisk(market);
  return a != null && a < RISK_THRESHOLD;
}

const KEY = "auto-tickets:hide-risky-markets";

export function getHideRisky(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1";
}

export function setHideRisky(v: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, v ? "1" : "0");
}
