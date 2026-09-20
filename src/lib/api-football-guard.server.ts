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

/** Chave do interruptor de bloqueio automático em 80% (persistido no banco). */
const AUTO_BLOCK_KEY = "api_football_auto_block";
/** Percentual da cota diária que dispara o bloqueio automático. */
const AUTO_BLOCK_PCT = 80;
/** Validade longa do interruptor no cache (90 dias; renova a cada gravação). */
const AUTO_BLOCK_TTL_MS = 90 * 24 * 60 * 60_000;

function entitlementDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Teto padrão quando `API_DAILY_BUDGET` não está definido ou é inválido. */
export const DEFAULT_DAILY_BUDGET = 7000;
/** Margem mantida sempre livre no saldo real informado pela API. */
const REMAINING_RESERVE = 200;
const REMAINING_KEY = "api_football_remaining";
let remainingMem: { at: number; left: number; limit: number | null } | null = null;

/**
 * Registra o saldo real do dia informado pela própria API-Football
 * (cabeçalhos `x-ratelimit-requests-remaining` / `x-ratelimit-requests-limit`).
 * É a fonte mais confiável. Grava também o teto do plano para calcular o 80%.
 */
export async function noteRemaining(headers: Headers): Promise<void> {
  const rawLeft = headers.get("x-ratelimit-requests-remaining");
  const rawLimit = headers.get("x-ratelimit-requests-limit");
  const left = rawLeft == null ? NaN : Number(rawLeft);
  const limit = rawLimit == null ? NaN : Number(rawLimit);
  if (!Number.isFinite(left)) return;
  remainingMem = { at: Date.now(), left, limit: Number.isFinite(limit) ? limit : null };
  try {
    const endOfDay = new Date();
    endOfDay.setUTCHours(23, 59, 59, 999);
    await setCachedData(REMAINING_KEY, { left, limit: Number.isFinite(limit) ? limit : null }, Math.max(1, endOfDay.getTime() - Date.now()));
  } catch {
    /* melhor esforço */
  }
}

type RemainingInfo = { left: number; limit: number | null };
async function remainingInfo(): Promise<RemainingInfo | null> {
  if (remainingMem && Date.now() - remainingMem.at < 60_000) {
    return { left: remainingMem.left, limit: remainingMem.limit };
  }
  try {
    const cached = (await getCachedData(REMAINING_KEY)) as { left?: unknown; limit?: unknown } | null;
    if (typeof cached?.left === "number") {
      return {
        left: cached.left,
        limit: typeof cached.limit === "number" ? cached.limit : null,
      };
    }
  } catch {
    /* sem cache: segue pelo contador local */
  }
  return null;
}
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

/** Lê o estado do bloqueio automático em 80% (padrão LIGADO). */
export async function getAutoBlockEnabled(): Promise<boolean> {
  try {
    const v = await getCachedData(AUTO_BLOCK_KEY);
    return v == null ? true : v === true;
  } catch {
    return true;
  }
}

/** Liga/desliga o bloqueio automático em 80% (persistente no banco). */
export async function setAutoBlockEnabled(on: boolean): Promise<void> {
  try {
    await setCachedData(AUTO_BLOCK_KEY, on, AUTO_BLOCK_TTL_MS);
  } catch {
    /* melhor esforço */
  }
}

/**
 * Verifica se ainda há cota hoje e, em caso positivo, incrementa a contagem.
 * Retorna `false` quando a chamada deve ser PULADA (usa o cache longo).
 *
 * Regras (em ordem):
 *  1. Bloqueio automático em 80% — se o saldo real/contador estiver em ou
 *     acima de 80% da cota, bloqueia sem pedir autorização.
 *  2. Saldo real informado pela API quase no fim → bloqueia.
 *  3. Contador local atingiu o teto diário → bloqueia.
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

  // Fonte de verdade: saldo real informado pela API, quando disponível.
  const info = await remainingInfo();

  // Regra 1 — bloqueio automático em 80%.
  if (await getAutoBlockEnabled()) {
    const budget = dailyBudget();
    const limit = info?.limit ?? budget;
    const used = info?.left != null ? Math.max(0, limit - info.left) : count;
    const pct = limit > 0 ? (used / limit) * 100 : 0;
    if (pct >= AUTO_BLOCK_PCT) {
      console.error(`[api-guard] Cota em ${pct.toFixed(0)}% — bloqueio automático de 80% ativado (uso: ${used}/${limit}).`);
      return false;
    }
  }

  // Regra 2 — saldo real quase no fim.
  if (info != null && info.left <= REMAINING_RESERVE) {
    console.error(`[api-guard] Saldo real da API quase no fim (${info.left}) — usando cache longo.`);
    return false;
  }

  // Regra 3 — teto do contador local.
  const budget = dailyBudget();
  if (info == null && count >= budget) {
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

/** Relatório do momento para o painel "Minha API" (faz somente leituras). */
export async function quotaReport(): Promise<{
  count: number;
  budget: number;
  left: number | null;
  limit: number | null;
  autoBlock: boolean;
  pct: number;
  used: number;
  remaining: number;
}> {
  let count = 0;
  const key = `${QUOTA_COUNTER_PREFIX}:${entitlementDayKey()}`;
  try {
    const cached = await getCachedData(key);
    const payload = cached as { count?: unknown } | null;
    count = typeof payload?.count === "number" ? payload.count : 0;
  } catch {
    /* ignore */
  }
  const info = await remainingInfo();
  const autoBlock = await getAutoBlockEnabled();
  const budget = dailyBudget();
  const limit = info?.limit ?? budget;
  const used = info?.left != null ? Math.max(0, limit - info.left) : Math.min(count, budget);
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  return { count, budget, left: info?.left ?? null, limit, autoBlock, pct, used, remaining: Math.max(0, limit - used) };
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