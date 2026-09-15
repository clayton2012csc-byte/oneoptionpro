/**
 * Proteção compartilhada de consumo da API-Football.
 *
 * Usada TANTO pelo robô (api-football-raw.server.ts) QUANTO pelas páginas do
 * site (api-football.functions.ts), porque todos consomem a MESMA assinatura.
 *
 *  - `spendApiCall()`: teto diário — só conta chamadas REAIS; ao bater o teto,
 *    devolve `false` e o chamador usa o cache longo (o site nunca fica vazio).
 *  - `readSnapshot()`/`writeSnapshot()`: cache longo de sobrevivência (7 dias)
 *    gravado a cada sucesso; o site continua exibindo dados mesmo dias depois,
 *    se a cota acabar ou a API falhar.
 */
import { getCachedData, setCachedData } from "./api-football-cache.server";

const QUOTA_COUNTER_PREFIX = "api_football_daily_quota";

const SNAPSHOT_SUFFIX = "#snapshot";
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60_000;

function entitlementDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Teto padrão quando `API_DAILY_BUDGET` não está definido ou é inválido. */
export const DEFAULT_DAILY_BUDGET = 1500;
const MAX_DAILY_BUDGET = 100_000;
let warned = false;

/**
 * Lê `API_DAILY_BUDGET` sem nunca quebrar o bootstrap: valor ausente, vazio,
 * não numérico ou fora da faixa cai no padrão (e avisa uma única vez).
 */
export function dailyBudget(): number {
  const env = process.env["API_DAILY_BUDGET"];
  if (env == null || String(env).trim() === "") return DEFAULT_DAILY_BUDGET;
  const raw = Number(env);
  if (!Number.isFinite(raw) || raw <= 0) {
    if (!warned) {
      warned = true;
      console.warn(`[api-guard] API_DAILY_BUDGET inválido — usando padrão ${DEFAULT_DAILY_BUDGET}.`);
    }
    return DEFAULT_DAILY_BUDGET;
  }
  return Math.min(Math.floor(raw), MAX_DAILY_BUDGET);
}

/** Guarda o contador em `api_cache` com validade até o fim do dia. */
async function persistQuotaCounter(key: string, count: number): Promise<void> {
  const endOfDay = new Date();
  endOfDay.setUTCHours(23, 59, 59, 999);
  await setCachedData(key, { count, day: entitlementDayKey() }, Math.max(1, endOfDay.getTime() - Date.now()));
}

/**
 * Verifica se ainda há cota hoje e, em caso positivo, incrementa a contagem.
 * Retorna `false` quando o teto diário foi atingido (chamada deve ser pulada).
 */
export async function spendApiCall(): Promise<boolean> {
  const key = `${QUOTA_COUNTER_PREFIX}:${entitlementDayKey()}`;
  let count = 0;
  try {
    const cached = await getCachedData(key);
    const payload = cached as { count?: unknown } | null;
    count = typeof payload?.count === "number" ? payload.count : 0;
  } catch {
    /* Supabase desligado: segue sem limite (nada a proteger). */
  }

  const budget = dailyBudget();
  if (count >= budget) {
    console.error(`[api-guard] Cota diária excedida (${count}/${budget}) — usando cache longo.`);
    return false;
  }
  try {
    await persistQuotaCounter(key, count + 1);
  } catch {
    /* não bloqueia a chamada se o contador não puder ser persistido */
  }
  return true;
}

/** Lê o cache longo de sobrevivência de uma URL (vazio se nunca gravado). */
export async function readSnapshot(cacheKey: string): Promise<unknown[]> {
  try {
    const snap = await getCachedData(cacheKey + SNAPSHOT_SUFFIX);
    return Array.isArray(snap) ? snap : [];
  } catch {
    return [];
  }
}

/** Grava o cache longo de sobrevivência de uma URL (melhor esforço). */
export async function writeSnapshot(cacheKey: string, data: unknown[]): Promise<void> {
  try {
    await setCachedData(cacheKey + SNAPSHOT_SUFFIX, data, SNAPSHOT_TTL_MS);
  } catch {
    /* segue com o cache normal */
  }
}