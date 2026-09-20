/**
 * Acesso direto (server-only) à API-Football usando SOMENTE parâmetros
 * disponíveis no plano atual (consultas por data). Os parâmetros `next` e
 * `last` são bloqueados pelo plano — por isso montamos o histórico e a agenda
 * a partir de consultas `?date=YYYY-MM-DD`, que são cacheadas no banco.
 */
import type { ApiFixture } from "./api-football.functions";
import { getCachedData, setCachedData } from "./api-football-cache.server";
import { spendApiCall, readSnapshot, writeSnapshot } from "./api-football-guard.server";

const BASE = "https://v3.football.api-sports.io";
const TZ = "America/Sao_Paulo";
const FINISHED = new Set(["FT", "AET", "PEN"]);

const mem = new Map<string, { at: number; ttl: number; data: unknown }>();

async function apiRaw(path: string, params: Record<string, string | number>, ttlMs: number) {
  const key = process.env["API_FOOTBALL_KEY"];
  if (!key) {
    console.error("[api-raw] API_FOOTBALL_KEY ausente");
    return [];
  }
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const cacheKey = url.toString();

  const m = mem.get(cacheKey);
  if (m && Date.now() - m.at < m.ttl) return m.data;

  const db = await getCachedData(cacheKey);
  if (db) {
    mem.set(cacheKey, { at: Date.now(), ttl: ttlMs, data: db });
    return db;
  }

  // Teto diário do plano: somente conta chamadas REAIS (fora do cache).
  // Quando bloqueado, usa o "cache longo" gravado para o site continuar carregando.
  if (!(await spendApiCall())) return await readSnapshot(cacheKey);

  try {
    const res = await fetch(cacheKey, {
      headers: { "x-apisports-key": key },
      signal: AbortSignal.timeout(25_000),
    });
    void noteRemaining(res.headers);
    const json = (await res.json()) as { response?: unknown; errors?: unknown };
    const errs = json.errors;
    const hasErr = Array.isArray(errs) ? errs.length > 0 : errs && Object.keys(errs).length > 0;
    if (hasErr) {
      console.error(`[api-raw] ${path}`, JSON.stringify(errs));
      return await readSnapshot(cacheKey);
    }
    const data = (Array.isArray(json.response) ? json.response : []) as unknown[];
    mem.set(cacheKey, { at: Date.now(), ttl: ttlMs, data });
    void setCachedData(cacheKey, data, ttlMs).catch(() => {});
    // Cache longo: garante que o site continua carregando mesmo dias depois,
    // inclusive se a cota da API acabar.
    void writeSnapshot(cacheKey, data);
    return data;
  } catch (e) {
    console.error(`[api-raw] ${path} erro:`, (e as Error).message);
    return await readSnapshot(cacheKey);
  }
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** Todos os jogos de um dia (cache curto para hoje, longo para dias passados). */
export async function fixturesByDate(date: string): Promise<ApiFixture[]> {
  const isPast = date < ymd(new Date());
  const ttl = isPast ? 7 * 24 * 60 * 60_000 : 30 * 60_000; // hoje: 30min (menos chamadas repetidas)
  return (await apiRaw("/fixtures", { date, timezone: TZ }, ttl)) as ApiFixture[];
}

/** Agenda das próximas `hours` horas (usa hoje + amanhã + depois se necessário). */
export async function upcomingFixtures(hours = 24): Promise<ApiFixture[]> {
  const now = Date.now();
  const horizon = now + hours * 60 * 60_000;
  const days = [0, 1, 2].map((i) => ymd(new Date(now + i * 86_400_000)));
  const out: ApiFixture[] = [];
  for (const d of days) {
    const list = await fixturesByDate(d);
    for (const f of list) {
      const ts = f.fixture.timestamp * 1000;
      if (f.fixture.status.short === "NS" && ts > now && ts <= horizon) out.push(f);
    }
    if (out.length && new Date(d + "T23:59:59Z").getTime() > horizon) break;
  }
  return out.sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
}

/** Índice de jogos encerrados dos últimos `days` dias, agrupado por time. */
const idxMemo = new Map<string, { at: number; idx: Map<number, ApiFixture[]> }>();
const IDX_TTL = 24 * 60 * 60_000; // estatísticas recentes dos times: cache de 24h

export async function recentFinishedIndex(days = 12): Promise<Map<number, ApiFixture[]>> {
  const memoKey = `recent:${days}:${ymd(new Date())}`;
  const hit = idxMemo.get(memoKey);
  if (hit && Date.now() - hit.at < IDX_TTL) return hit.idx;
  const idx = new Map<number, ApiFixture[]>();
  const now = Date.now();
  for (let i = 1; i <= days; i++) {
    const list = await fixturesByDate(ymd(new Date(now - i * 86_400_000)));
    for (const f of list) {
      if (!FINISHED.has(f.fixture.status.short)) continue;
      for (const id of [f.teams.home.id, f.teams.away.id]) {
        const arr = idx.get(id) ?? [];
        arr.push(f);
        idx.set(id, arr);
      }
    }
  }
  for (const [, arr] of idx) arr.sort((a, b) => b.fixture.timestamp - a.fixture.timestamp);
  idxMemo.set(memoKey, { at: Date.now(), idx });
  return idx;
}

/**
 * Scout de um jogo encerrado (escanteios e cartões), usado SOMENTE na
 * conferência e com cache longo — nunca na montagem dos bilhetes.
 */
export interface FixtureScout {
  corners: number | null;
  cards: number | null;
}

type StatItem = { type?: string; value?: number | string | null };
type StatBlock = { statistics?: StatItem[] };

function readStat(blocks: StatBlock[], names: string[]): number | null {
  let total = 0;
  let found = false;
  for (const b of blocks) {
    for (const s of b.statistics ?? []) {
      const type = String(s.type ?? "").toLowerCase();
      if (!names.some((n) => type === n)) continue;
      const v = typeof s.value === "string" ? Number(s.value.replace("%", "")) : s.value;
      if (typeof v === "number" && Number.isFinite(v)) {
        total += v;
        found = true;
      }
    }
  }
  return found ? total : null;
}

export async function fixtureScout(id: number): Promise<FixtureScout> {
  const blocks = (await apiRaw("/fixtures/statistics", { fixture: id }, 7 * 24 * 60 * 60_000)) as StatBlock[];
  if (!Array.isArray(blocks) || !blocks.length) return { corners: null, cards: null };
  const corners = readStat(blocks, ["corner kicks"]);
  const yellow = readStat(blocks, ["yellow cards"]);
  const red = readStat(blocks, ["red cards"]);
  const cards = yellow == null && red == null ? null : (yellow ?? 0) + (red ?? 0);
  return { corners, cards };
}

/** Busca um jogo específico pelo id (permitido no plano). */
export async function fixtureById(id: number): Promise<ApiFixture | null> {
  const arr = (await apiRaw("/fixtures", { id, timezone: TZ }, 60_000)) as ApiFixture[];
  return arr[0] ?? null;
}

/**
 * Jogos ENCERRADOS de uma data — uma única requisição por dia, cacheada.
 * Base do grading em lote (nunca chamar estatísticas jogo a jogo).
 */
export async function finishedFixturesByDate(date: string): Promise<ApiFixture[]> {
  const isPast = date < ymd(new Date());
  const ttl = isPast ? 24 * 60 * 60_000 : 15 * 60_000;
  const list = (await apiRaw(
    "/fixtures",
    { date, status: "FT-AET-PEN", timezone: TZ },
    ttl,
  )) as ApiFixture[];
  return (list ?? []).filter((f) => FINISHED.has(f.fixture.status.short));
}
