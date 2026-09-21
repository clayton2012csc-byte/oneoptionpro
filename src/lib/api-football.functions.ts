import { createServerFn } from "@tanstack/react-start";
import {
  spendApiCall,
  readSnapshot,
  writeSnapshot,
  noteRemaining,
  quotaReport,
  getAutoBlockEnabled,
  setAutoBlockEnabled,
} from "./api-football-guard.server";
import { getCachedData, setCachedData } from "./api-football-cache.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const BASE = "https://v3.football.api-sports.io";
const TZ = "America/Sao_Paulo";

const cache = new Map<string, { at: number; data: unknown }>();
const CACHE_MS = 60_000; // Increased to 60s to save API quota

/** TTL maior por rota — economiza a cota diária (plano free: 100 req/dia). */
function ttlFor(path: string, params: Record<string, any> = {}): number {
  if (path.startsWith("/teams/statistics")) return 24 * 60 * 60_000; // 24h (estatísticas de jogos encerrados não mudam)
  if (path.startsWith("/fixtures/statistics")) return 7 * 24 * 60 * 60_000; // 7 dias (stats de jogos passados são definitivas)
  if (path.startsWith("/odds")) return 60 * 60_000; // 1h
  if (path.startsWith("/standings") || path.startsWith("/injuries")) return 2 * 60 * 60_000; // 2h
  if (path.startsWith("/fixtures/headtohead")) return 12 * 60 * 60_000; // 12h
  
  if (path === "/fixtures") {
    // Página de um jogo específico: reaproveita por 5 min (a página já refaz
    // a leitura sozinha a cada minuto quando o jogo está em andamento).
    if (params.id) return 5 * 60_000;
    const isToday = params.date === new Date().toISOString().split("T")[0];
    if (params.live === "all" || isToday) return 60_000;
    return 30 * 60_000; // 30min para datas passadas ou futuras distantes
  }
  
  return CACHE_MS;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROMISE_TIMEOUT = 25_000;
const BATCH_CONCURRENCY = 10; // Pro plan (7500/dia)

// ---- Limitador global (rede de segurança). Mantido abaixo do teto do plano ----
const RPM_LIMIT = 200; // Pro plan: teto 300/min, margem de seguranca

const recentCalls: number[] = [];
let gate: Promise<void> = Promise.resolve();

async function acquireSlot() {
  const mine = gate.then(async () => {
    for (;;) {
      const now = Date.now();
      while (recentCalls.length > 0 && now - recentCalls[0] > 60_000) recentCalls.shift();
      if (recentCalls.length < RPM_LIMIT) {
        recentCalls.push(now);
        return;
      }
      await sleep(Math.max(250, 60_000 - (now - recentCalls[0]) + 100));
    }
  });
  gate = mine.catch(() => undefined);
  return mine;
}

async function apiGet(path: string, params: Record<string, string | number | undefined> = {}, ttlOverride?: number) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) {
    console.error("[api-football] API_FOOTBALL_KEY not set");
    return [];
  }
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const cacheKey = url.toString();
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < (ttlOverride ?? ttlFor(path, params))) return cached.data;
  
  // 2. Database cache (persistent)
  const ttl = ttlOverride ?? ttlFor(path, params);
  const { getCachedData, setCachedData, cleanupCache } = await import("./api-football-cache.server");
  
  const dbCached = await getCachedData(cacheKey);
  if (dbCached) {
    // Re-populate in-memory cache
    cache.set(cacheKey, { at: Date.now(), data: dbCached });
    return dbCached;
  }

  // Teto diário do plano (compartilhado com o robô): se bateu, usa o cache longo.
  if (!(await spendApiCall())) return await readSnapshot(cacheKey);

  await acquireSlot();



  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(cacheKey, {
        headers: { "x-apisports-key": key },
        signal: AbortSignal.timeout(PROMISE_TIMEOUT),
      });
      void noteRemaining(res.headers);
      if (!res.ok) {
        if (res.status === 429 && attempt < maxAttempts) {
          await sleep(6_000 * attempt);
          await acquireSlot();
          continue;
        }
        const text = await res.text().catch(() => "");
        console.error(`[api-football] ${path} ${res.status}: ${text.slice(0, 200)}`);
        return cached?.data ?? (await readSnapshot(cacheKey));
      }
      const json = (await res.json()) as { response?: unknown; errors?: unknown };
      const errs = json.errors;
      const errObj = errs && typeof errs === "object" && !Array.isArray(errs) ? (errs as Record<string, string>) : null;
      const isRateLimit = errObj && (errObj.rateLimit || errObj.requests);
      if (isRateLimit && attempt < maxAttempts) {
        // limite por minuto: espera a janela virar antes de tentar de novo
        await sleep(6_000 * attempt);
        await acquireSlot();
        continue;
      }

      const hasErr = Array.isArray(errs) ? errs.length > 0 : errObj ? Object.keys(errObj).length > 0 : false;
      if (hasErr) {
        console.error(`[api-football] ${path} errors:`, JSON.stringify(errs));
        return cached?.data ?? (await readSnapshot(cacheKey));
      }
      const data = (Array.isArray(json.response) ? json.response : []) as unknown[];

      // Nunca grava resultado vazio no cache (nem no DB nem no snapshot): isso
      // gerava milhares de entradas `data=[]` e a grade de estatísticas sumia.
      if (Array.isArray(data) && data.length === 0) {
        console.warn(`[api-football] ${path} retornou vazio — não será cacheadol.`);
        return data;
      }

      cache.set(cacheKey, { at: Date.now(), data });
      
      // Save to database cache asynchronously
      setCachedData(cacheKey, data, ttl).catch(e => console.error("[api-football] Cache write failed:", e));

      // Cache longo de sobrevivência: site continua carregando se a API falhar/acabar.
      void writeSnapshot(cacheKey, data);
      
      // Occasionally cleanup old cache (1 in 50 chance on write)
      if (Math.random() < 0.02) {
        cleanupCache().catch(() => {});
      }
      
      return data;
    } catch (err) {
      if (attempt < maxAttempts) {
        await sleep(1000 * attempt);
        continue;
      }
      console.error(`[api-football] ${path} network error:`, (err as Error).message);
      return cached?.data ?? (await readSnapshot(cacheKey));
    }
  }
  return cached?.data ?? (await readSnapshot(cacheKey));
}

/** Monta um ApiFixture a partir de uma linha do auto_tickets (fallback offline). */
function fixtureFromTicketRow(row: {
  fixture_id: number;
  kickoff: string;
  league: string | null;
  home: string;
  away: string;
  home_logo?: string | null;
  away_logo?: string | null;
}): ApiFixture | null {
  try {
    const kickoff = row.kickoff || new Date().toISOString();
    const ts = Math.floor(new Date(kickoff).getTime() / 1000);
    const past = ts * 1000 <= Date.now();
    return {
      fixture: {
        id: row.fixture_id,
        referee: null,
        timezone: TZ,
        date: kickoff,
        timestamp: ts,
        status: past
          ? { long: "Match Finished", short: "FT", elapsed: null }
          : { long: "Not Started", short: "NS", elapsed: null },
        venue: { id: null, name: null, city: null },
      },
      league: {
        id: 0,
        name: row.league || "Liga local",
        country: "",
        logo: "",
        flag: null,
        season: new Date(kickoff).getUTCFullYear(),
        round: "",
      },
      teams: {
        home: { id: -(row.fixture_id), name: row.home, logo: row.home_logo || "" },
        away: { id: -(row.fixture_id) - 1, name: row.away, logo: row.away_logo || "" },
      },
      goals: { home: null, away: null },
      score: {
        halftime: { home: null, away: null },
        fulltime: { home: null, away: null },
        extratime: { home: null, away: null },
        penalty: { home: null, away: null },
      },
    };
  } catch {
    return null;
  }
}

/** Jogos salvos no banco para uma data (grade offline: nunca fica vazia). */
async function localFixturesForDay(dateStr: string): Promise<ApiFixture[]> {
  try {
    const from = new Date(`${dateStr}T00:00:00-03:00`);
    const until = new Date(from.getTime() + 24 * 60 * 60 * 1000);
    const { data } = await supabaseAdmin
      .from("auto_tickets")
      .select("fixture_id, kickoff, league, home, away, home_logo, away_logo")
      .neq("status", "skipped")
      .gte("kickoff", from.toISOString())
      .lt("kickoff", until.toISOString())
      .limit(800);
    return (data ?? [])
      .map(fixtureFromTicketRow)
      .filter((f): f is ApiFixture => f !== null);
  } catch {
    return [];
  }
}

/** Mescla os jogos da API com os salvos no banco (sem duplicar por fixture_id). */
function mergeFixtures(api: ApiFixture[], local: ApiFixture[]): ApiFixture[] {
  if (!local.length) return api;
  const seen = new Set(api.map((f) => f.fixture.id));
  const extras = local.filter((f) => !seen.has(f.fixture.id));
  if (!extras.length) return api;
  return [...api, ...extras].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
}

export const getFixturesByDate = createServerFn({ method: "GET" })
  .inputValidator((d: { date: string }) => d)
  .handler(async ({ data }) => {
    const api = (await apiGet("/fixtures", { date: data.date, timezone: TZ })) as ApiFixture[];
    // Se a API/cache não trouxe nada (cota zerada / sem snapshot), usa o que está salvo no banco.
    if (api.length === 0) return await localFixturesForDay(data.date);
    return mergeFixtures(api, await localFixturesForDay(data.date));
  });

export const getLiveFixtures = createServerFn({ method: "GET" }).handler(async () => {
  return (await apiGet("/fixtures", { live: "all", timezone: TZ })) as ApiFixture[];
});

export const getNextFixturesToScan = createServerFn({ method: "GET" })
  .inputValidator((d: { count?: number }) => d)
  .handler(async ({ data }) => {
    const api = (await apiGet("/fixtures", { next: data.count ?? 50, timezone: TZ })) as ApiFixture[];
    if (api.length > 0) return api;
    // Fallback offline: jogos das próximas 24h a partir do banco.
    try {
      const from = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: rows } = await supabaseAdmin
        .from("auto_tickets")
        .select("fixture_id, kickoff, league, home, away, home_logo, away_logo")
        .neq("status", "skipped")
        .gte("kickoff", from)
        .lte("kickoff", until)
        .order("kickoff", { ascending: true })
        .limit(800);
      return (rows ?? []).map(fixtureFromTicketRow).filter((f): f is ApiFixture => f !== null);
    } catch {
      return [];
    }
  });

export interface ApiStatus {
  account: { firstname: string; lastname: string; email: string };
  subscription: { plan: string; end: string; active: boolean };
  requests: { current: number; limit_day: number };
}

/** Cache em memória do /status para não repetir chamada a cada abertura do painel. */
let STATUS_MEM: { at: number; data: ApiStatus } | null = null;
const STATUS_MEM_TTL = 5 * 60_000;

/** Lê o /status REAL da API-Football, cacheado (5min em memória + DB), sem gastar cota à toa. */
async function fetchApiStatus(): Promise<ApiStatus | null> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return null;

  if (STATUS_MEM && Date.now() - STATUS_MEM.at < STATUS_MEM_TTL) return STATUS_MEM.data;

  const STATUS_KEY = "https://v3.football.api-sports.io/status";
  const dbCached = (await getCachedData(STATUS_KEY).catch(() => null)) as ApiStatus | null;
  if (dbCached && typeof dbCached === "object" && "requests" in dbCached) {
    STATUS_MEM = { at: Date.now(), data: dbCached };
    return dbCached;
  }

  // Só faz a chamada REAL se a cota permitir — senão devolve o que já salvamos (ou null).
  if (!(await spendApiCall())) {
    return STATUS_MEM?.data ?? null;
  }

  try {
    const res = await fetch(STATUS_KEY, {
      headers: { "x-apisports-key": key },
      signal: AbortSignal.timeout(25_000),
    });
    void noteRemaining(res.headers);
    const json = (await res.json()) as { response?: unknown };
    const r = json.response;
    if (r && typeof r === "object" && "requests" in (r as object)) {
      const status = r as ApiStatus;
      STATUS_MEM = { at: Date.now(), data: status };
      void setCachedData(STATUS_KEY, status, 60_000).catch(() => {});
      return status;
    }
    return null;
  } catch (err) {
    console.error("[api-football] /status error:", (err as Error).message);
    return STATUS_MEM?.data ?? dbCached ?? null;
  }
}

export const getApiStatus = createServerFn({ method: "GET" }).handler(async () => await fetchApiStatus());

/**
 * Dados consolidados para o painel "Minha API" (somente leituras de cache/banco,
 * NÃO gasta cota). Combina o contador local com o saldo real informado pela API.
 */
export const getApiPanelData = createServerFn({ method: "GET" }).handler(async () => {
  const report = await quotaReport();
  const status = await fetchApiStatus().catch(() => null);
  return {
    ...report,
    plan: status?.subscription?.plan ?? null,
    planActive: status?.subscription?.active ?? null,
    planEnd: status?.subscription?.end ?? null,
  };
});

/** Liga/desliga o bloqueio automático em 80% (persistente). */
export const setApiAutoBlock = createServerFn({ method: "POST" })
  .inputValidator((d: { on: boolean }) => d)
  .handler(async ({ data }) => {
    await setAutoBlockEnabled(data.on);
    return { ok: true, on: data.on };
  });

/** Estado atual do interruptor de bloqueio automático. */
export const getApiAutoBlock = createServerFn({ method: "GET" }).handler(async () => ({
  on: await getAutoBlockEnabled(),
}));

export const getFixture = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const arr = (await apiGet("/fixtures", { id: data.id, timezone: TZ })) as ApiFixture[];
    if (arr[0]) return arr[0];

    // Fallback local: monta o jogo a partir do banco quando a API não retorna nada.
    return fixtureFromLocal(data.id);
  });

export const getFixtureEvents = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures/events", { fixture: data.id })) as ApiEvent[];
  });

/** Valores numéricos das features/previsões locais de um fixture (fallback quando a API não responde). */
interface LocalFixtureMeta {
  fixtureId: number;
  home: string;
  away: string;
  league: string | null;
  kickoff: string;
  features?: Record<string, any> | null;
}

/** Lê os dados locais de um fixture: auto_tickets (nomes/horário) + ai_predictions (features com odds/palpites). */
async function loadLocalFixtureMeta(id: number): Promise<LocalFixtureMeta | null> {
  try {
    const { data: rows } = await supabaseAdmin
      .from("auto_tickets")
      .select("fixture_id, kickoff, league, home, away")
      .eq("fixture_id", id)
      .limit(1);

    const row = rows?.[0];
    if (!row) return null;

    const { data: predRows } = await supabaseAdmin
      .from("ai_predictions")
      .select("features")
      .eq("fixture_id", id)
      .limit(1);

    return {
      fixtureId: id,
      home: row.home,
      away: row.away,
      league: row.league ?? null,
      kickoff: row.kickoff ?? new Date().toISOString(),
      features: (predRows?.[0]?.features as Record<string, any> | null) ?? null,
    };
  } catch {
    return null;
  }
}

/** Monta um ApiFixture mínimo a partir dos dados locais (evita a tela "Jogo não encontrado"). */
async function fixtureFromLocal(id: number): Promise<ApiFixture | null> {
  const meta = await loadLocalFixtureMeta(id);
  if (!meta) return null;

  const kickoff = meta.kickoff || new Date().toISOString();
  const ts = Math.floor(new Date(kickoff).getTime() / 1000);
  const past = ts * 1000 <= Date.now();

  return {
    fixture: {
      id,
      referee: null,
      timezone: TZ,
      date: kickoff,
      timestamp: ts,
      status: past
        ? { long: "Match Finished", short: "FT", elapsed: null }
        : { long: "Not Started", short: "NS", elapsed: null },
      venue: { id: null, name: null, city: null },
    },
    league: {
      id: 0,
      name: meta.league ?? "Liga local",
      country: "",
      logo: "",
      flag: null,
      season: past ? new Date(kickoff).getUTCFullYear() - 1 : new Date(kickoff).getUTCFullYear(),
      round: "",
    },
    teams: {
      home: { id: -id, name: meta.home, logo: "" },
      away: { id: -(id) - 1, name: meta.away, logo: "" },
    },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

/** Extrai o número da linha de um pick de mercado (ex: "Mais de 9.5 escanteios" → 9.5). */
function lineOf(selection: string | undefined): number | null {
  if (!selection) return null;
  const m = selection.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Converte os picks salvos (features.picks) em estatísticas por time. */
function statsFromPicks(meta: LocalFixtureMeta): ApiTeamStats[] | null {
  const picks: { market?: string; selection?: string; prob?: number }[] = Array.isArray(meta.features?.picks) ? meta.features!.picks : [];
  const pickOf = (market: string) => picks.find((p) => p.market === market);
  const probOf = (p: { prob?: number } | undefined, fallback: number) => (p && typeof p.prob === "number" ? p.prob : fallback);

  const lambdaHome = typeof meta.features?.lambdaHome === "number" ? meta.features.lambdaHome : null;
  const lambdaAway = typeof meta.features?.lambdaAway === "number" ? meta.features.lambdaAway : null;
  const cornersTotal =
    typeof meta.features?.lambdaCornersTotal === "number"
      ? meta.features.lambdaCornersTotal
      : typeof meta.features?.expectedCorners === "number"
        ? meta.features.expectedCorners
        : lineOf(pickOf("Escanteios")?.selection);

  const homeStats: { type: string; value: number | string | null }[] = [];
  const awayStats: { type: string; value: number | string | null }[] = [];

  if (lambdaHome != null && lambdaAway != null) {
    homeStats.push({ type: "expected_goals", value: lambdaHome });
    awayStats.push({ type: "expected_goals", value: lambdaAway });
  }

  const cornersSplit = cornersTotal != null ? Number(cornersTotal) / 2 : null;
  homeStats.push({ type: "Corner Kicks", value: cornersSplit != null ? Math.round(cornersSplit) : 5 });
  awayStats.push({ type: "Corner Kicks", value: cornersSplit != null ? Math.round(cornersSplit) : 5 });

  const gols = pickOf("Gols Dinâmico");
  if (!lambdaHome || !lambdaAway) {
    const totalGoalsLine = lineOf(gols?.selection);
    if (totalGoalsLine != null) {
      homeStats.push({ type: "expected_goals", value: Math.min(2, Number(totalGoalsLine) / 2) });
      awayStats.push({ type: "expected_goals", value: Math.min(2, Number(totalGoalsLine) / 2) });
    }
  }

  const btts = pickOf("Ambas Marcam");
  if (btts) {
    const pBtts = probOf(btts, 0.5);
    homeStats.push({ type: "Ambas marcam (%)", value: Math.round(pBtts * 100) });
    awayStats.push({ type: "Ambas marcam (%)", value: Math.round(pBtts * 100) });
  }

  const cards = pickOf("Cartões");
  const cardsLine = lineOf(cards?.selection);
  if (cardsLine != null) {
    const split = Number(cardsLine) / 2;
    homeStats.push({ type: "Yellow Cards", value: Math.round(split) });
    awayStats.push({ type: "Yellow Cards", value: Math.round(split) });
  }

  const margem = pickOf("Margem de Vitória");
  if (margem) {
    const pMargem = probOf(margem, 0.5);
    const homeMarginSel = /(?:casa|home)/i.test(margem.selection ?? "");
    homeStats.push({ type: "Margem de vitória (%)", value: homeMarginSel ? Math.round(pMargem * 100) : Math.round((1 - pMargem) * 100) });
    awayStats.push({ type: "Margem de vitória (%)", value: homeMarginSel ? Math.round((1 - pMargem) * 100) : Math.round(pMargem * 100) });
  }

  const home: ApiTeamStats = { team: { id: -meta.fixtureId, name: meta.home, logo: "" }, statistics: homeStats };
  const away: ApiTeamStats = { team: { id: -(meta.fixtureId) - 1, name: meta.away, logo: "" }, statistics: awayStats };
  return [home, away];
}

export const getFixtureStatistics = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const stats = (await apiGet("/fixtures/statistics", { fixture: data.id })) as ApiTeamStats[];
    if (stats && stats.length > 0) return stats;

    // Fallback: dados de estatísticas vindos das previsões/features locais quando a API retorna vazio.
    try {
      const meta = await loadLocalFixtureMeta(data.id);
      if (meta) {
        const localStats = statsFromPicks(meta);
        if (localStats) return localStats;
      }
    } catch {
      console.warn("[api-football] fallback ai_predictions failed for fixture", data.id);
    }

    return stats;
  });

export const getFixtureLineups = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures/lineups", { fixture: data.id })) as ApiLineup[];
  });

export const getH2H = createServerFn({ method: "GET" })
  .inputValidator((d: { h2h: string; last?: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures/headtohead", { h2h: data.h2h, last: data.last ?? 10, timezone: TZ })) as ApiFixture[];
  });

export const getStandings = createServerFn({ method: "GET" })
  .inputValidator((d: { league: number; season: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/standings", { league: data.league, season: data.season })) as ApiStandingsResp[];
  });

export const getLeagueInfo = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const arr = (await apiGet("/leagues", { id: data.id })) as ApiLeagueSeason[];
    return arr[0] ?? null;
  });

export const getFixturesByLeague = createServerFn({ method: "GET" })
  .inputValidator((d: { league: number; season: number; next?: number; last?: number }) => d)
  .handler(async ({ data }) => {
    const params: Record<string, string | number> = { league: data.league, season: data.season, timezone: TZ };
    if (data.next) params.next = data.next;
    else if (data.last) params.last = data.last;
    else params.next = 20;
    return (await apiGet("/fixtures", params)) as ApiFixture[];
  });

export const getPredictions = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/predictions", { fixture: data.id })) as ApiPrediction[];
  });

export interface ApiTeamSeasonStats {
  team: ApiTeam;
  league: { id: number; name: string; season: number };
  form: string | null;
  fixtures: {
    played: { home: number; away: number; total: number };
    wins: { home: number; away: number; total: number };
    draws: { home: number; away: number; total: number };
    loses: { home: number; away: number; total: number };
  };
  goals: {
    for: {
      total: { home: number; away: number; total: number };
      average: { home: string; away: string; total: string };
      minute?: Record<string, { total: number | null; percentage: string | null }>;
    };
    against: {
      total: { home: number; away: number; total: number };
      average: { home: string; away: string; total: string };
      minute?: Record<string, { total: number | null; percentage: string | null }>;
    };
  };
  clean_sheet: { home: number; away: number; total: number };
  failed_to_score: { home: number; away: number; total: number };
  lineups?: { formation: string; played: number }[];
}

export const getTeamSeasonStatistics = createServerFn({ method: "GET" })
  .inputValidator((d: { team: number; league: number; season: number }) => d)
  .handler(async ({ data }) => {
    const r = (await apiGet("/teams/statistics", { team: data.team, league: data.league, season: data.season })) as ApiTeamSeasonStats | unknown;
    const ok = r && typeof r === "object" && "goals" in (r as object);
    if (!ok) {
      console.warn(`[api-football] team-stats empty for team=${data.team} league=${data.league} season=${data.season}`);
      return null;
    }
    const s = r as ApiTeamSeasonStats;
    console.log(`[api-football] team-stats ok team=${data.team} played=${s.fixtures?.played?.total} gf_avg=${s.goals?.for?.average?.total} ga_avg=${s.goals?.against?.average?.total} cs=${s.clean_sheet?.total} form=${s.form?.slice(-5)}`);
    return s;
  });

export const getTeamRecentFixtures = createServerFn({ method: "GET" })
  .inputValidator((d: { team: number; last?: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures", { team: data.team, last: data.last ?? 10, timezone: TZ })) as ApiFixture[];
  });

export const getTeamNextFixtures = createServerFn({ method: "GET" })
  .inputValidator((d: { team: number; next?: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures", { team: data.team, next: data.next ?? 10, timezone: TZ })) as ApiFixture[];
  });

export interface ApiTeamInfo {
  team: { id: number; name: string; code: string | null; country: string; founded: number | null; national: boolean; logo: string };
  venue: { id: number | null; name: string | null; address: string | null; city: string | null; capacity: number | null; surface: string | null; image: string | null };
}
export const getTeamInfo = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const arr = (await apiGet("/teams", { id: data.id })) as ApiTeamInfo[];
    return arr[0] ?? null;
  });

export const searchTeams = createServerFn({ method: "GET" })
  .inputValidator((d: { search: string }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/teams", { search: data.search })) as ApiTeamInfo[];
  });

export interface ApiLeagueSeason {
  league: { id: number; name: string; type: string; logo: string };
  country: { name: string; code: string | null; flag: string | null };
  seasons: { year: number; start: string; end: string; current: boolean }[];
}
export const getTeamLeagues = createServerFn({ method: "GET" })
  .inputValidator((d: { team: number; season?: number }) => d)
  .handler(async ({ data }) => {
    const params: Record<string, string | number> = { team: data.team };
    if (data.season) params.season = data.season;
    return (await apiGet("/leagues", params)) as ApiLeagueSeason[];
  });

export const getOdds = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/odds", { fixture: data.id })) as ApiOddsResp[];
  });

// ---- Odds da Betano (bookmaker 32) resumidas nos mercados do Bingão ----
export const BOOKMAKER_BETANO = 32;
const FALLBACK_BOOKMAKERS = [8, 6, 16, 26, 23]; // Bet365, Bwin, Unibet, Betsson, Sportingbet

export interface BingaoOdds {
  bookmaker: string;
  /** placares exatos: "1-0" | "0-1" | "2-0" | "0-2" | "2-1" | "1-2" */
  scores: Record<string, number>;
  under15?: number;
  over15?: number;
  under25?: number;
  over25?: number;
  bttsYes?: number;
  bttsNo?: number;
  draw?: number;
  homeWin?: number;
  awayWin?: number;
  /** escanteios: chave é a linha, ex "9.5" */
  cornersOver: Record<string, number>;
  cornersUnder: Record<string, number>;
}

type OddsBet = { id: number; name: string; values: { value: string; odd: string }[] };

function normScore(v: string): string | null {
  const m = v.replace(/\s/g, "").match(/^(\d+)[:x\-](\d+)$/i);
  if (!m) return null;
  return `${m[1]}-${m[2]}`;
}

function parseBets(bets: OddsBet[], bookmaker: string): BingaoOdds {
  const out: BingaoOdds = { bookmaker, scores: {}, cornersOver: {}, cornersUnder: {} };
  const num = (s: unknown) => {
    const n = Number(s);
    return Number.isFinite(n) && n > 1 ? n : undefined;
  };
  const str = (s: unknown) => (s == null ? "" : String(s));
  for (const bet of bets) {
    const name = str(bet.name).toLowerCase();
    for (const v of bet.values ?? []) {
      const odd = num(v.odd);
      if (!odd) continue;
      const raw = str(v.value);
      const val = raw.toLowerCase().trim();
      if (name === "exact score" || name === "correct score") {
        const key = normScore(raw);

        if (key && ["1-0", "0-1", "2-0", "0-2", "2-1", "1-2"].includes(key)) out.scores[key] = odd;
      } else if (name === "goals over/under") {
        if (val === "under 1.5") out.under15 = odd;
        else if (val === "over 1.5") out.over15 = odd;
        else if (val === "under 2.5") out.under25 = odd;
        else if (val === "over 2.5") out.over25 = odd;
      } else if (name === "both teams score") {
        if (val === "yes") out.bttsYes = odd;
        else if (val === "no") out.bttsNo = odd;
      } else if (name === "match winner") {
        if (val === "home" || val === "1") out.homeWin = odd;
        else if (val === "draw" || val === "x") out.draw = odd;
        else if (val === "away" || val === "2") out.awayWin = odd;
      } else if (name.includes("corner") && name.includes("over")) {
        const m = val.match(/(over|under)\s*([\d.]+)/);
        if (m) {
          if (m[1] === "over") out.cornersOver[m[2]] = odd;
          else out.cornersUnder[m[2]] = odd;
        }
      }
    }
  }
  return out;
}

/** 1 chamada por jogo: traz todos os mercados da Betano (com fallback para outra casa). */
export const getBingaoOdds = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const resp = (await apiGet("/odds", { fixture: data.id })) as {
      bookmakers?: { id: number; name: string; bets: OddsBet[] }[];
    }[];
    const books = resp?.[0]?.bookmakers ?? [];
    if (books.length === 0) return null;
    const pick =
      books.find((b) => b.id === BOOKMAKER_BETANO) ??
      FALLBACK_BOOKMAKERS.map((id) => books.find((b) => b.id === id)).find(Boolean) ??
      books[0];
    if (!pick) return null;
    return parseBets(pick.bets ?? [], pick.name);
  });

/**
 * Lista os fixture ids que têm odds na Betano (com fallback para as casas principais)
 * numa data. Poucas chamadas (10 jogos por página) e evita montar bilhete de jogo
 * que a Betano não oferece.
 */
export const getBookmakerFixtureIds = createServerFn({ method: "GET" })
  .inputValidator((d: { date: string; bookmaker?: number; maxPages?: number }) => d)
  .handler(async ({ data }) => {
    const key = process.env.API_FOOTBALL_KEY;
    if (!key) return [] as number[];
    const bookmaker = data.bookmaker ?? 32;
    const maxPages = Math.min(Math.max(data.maxPages ?? 6, 1), 15);
    const listKey = `bookmaker_fixtures:${bookmaker}:${data.date}`;

    // Cache persistente no banco (6h) — evita repetir dezenas de páginas a cada visita.
    try {
      const saved = (await getCachedData(listKey)) as number[] | null;
      if (Array.isArray(saved) && saved.length) return saved;
    } catch {
      /* segue e tenta a API */
    }

    const ids: number[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const url = new URL("https://v3.football.api-sports.io/odds");
      url.searchParams.set("date", data.date);
      url.searchParams.set("bookmaker", String(bookmaker));
      url.searchParams.set("timezone", "America/Sao_Paulo");
      url.searchParams.set("page", String(page));
      const cacheKey = url.toString();
      type OddsPage = {
        response?: { fixture?: { id?: number } }[];
        paging?: { current?: number; total?: number };
        errors?: unknown;
      };
      let json: OddsPage | null = null;

      const cachedPage = cache.get(cacheKey);
      if (cachedPage && Date.now() - cachedPage.at < 30 * 60_000) {
        json = cachedPage.data as OddsPage;
      } else {
        // Toda página conta na cota: se o guarda negar, paramos e usamos o que há.
        if (!(await spendApiCall())) break;
        for (let attempt = 1; attempt <= 3 && !json; attempt++) {
          await acquireSlot();
          try {
            const res = await fetch(cacheKey, {
              headers: { "x-apisports-key": key },
              signal: AbortSignal.timeout(15_000),
            });
            void noteRemaining(res.headers);
            if (res.status === 429) {
              await sleep(6_000 * attempt);
              continue;
            }
            if (!res.ok) break;
            const body: OddsPage = (await res.json()) as OddsPage;
            const errObj =
              body.errors && typeof body.errors === "object" && !Array.isArray(body.errors)
                ? (body.errors as Record<string, string>)
                : null;
            if (errObj && (errObj.rateLimit || errObj.requests)) {
              console.warn(`[api-football] odds page ${page} rate-limited: ${JSON.stringify(errObj)}`);
              await sleep(6_000 * attempt);
              continue;
            }
            json = body;
            cache.set(cacheKey, { at: Date.now(), data: body });
          } catch {
            await sleep(1000 * attempt);
          }
        }
      }
      if (!json) break;
      for (const r of json.response ?? []) {
        const id = r?.fixture?.id;
        if (typeof id === "number") ids.push(id);
      }
      const total = json.paging?.total ?? 1;
      if (page >= total) break;
    }

    const out = Array.from(new Set(ids));
    if (out.length) {
      try {
        await setCachedData(listKey, out, 6 * 60 * 60_000);
      } catch {
        /* melhor esforço */
      }
    }
    return out;
  });




export interface ApiInjury {
  player: { id: number; name: string; photo: string; type: string; reason: string };
  team: ApiTeam;
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  league: { id: number; season: number; name: string; country: string; logo: string; flag: string | null };
}
export const getTeamInjuries = createServerFn({ method: "GET" })
  .inputValidator((d: { team: number; league: number; season: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/injuries", { team: data.team, league: data.league, season: data.season })) as ApiInjury[];
  });

// ---- Match Preview (agregado dos últimos N jogos de cada time) ----
export interface TeamPreviewStats {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  goalsForAvg: number;
  goalsAgainstAvg: number;
  cornersFor: number;
  cornersAgainst: number;
  cornersForAvg: number;
  cornersAgainstAvg: number;
  cornersTotalAvg: number;
  /** quantos jogos realmente tinham dados de escanteios */
  cornersSample: number;
  /** true quando não havia estatística e usamos média estimada */
  cornersEstimated: boolean;

  shotsOnGoalAvg: number;
  cardsAvg: number;
  bttsPct: number;
  over25Pct: number;
  cleanSheetPct: number;
  failedToScorePct: number;
  form: string; // ex "VVEDV"
  lastResults: { date: string; opp: string; gf: number; ga: number; home: boolean; result: "V" | "E" | "D" }[];
}

function statNum(stats: { type: string; value: number | string | null }[] | undefined, type: string): number {
  if (!stats) return 0;
  const s = stats.find((x) => x.type === type);
  if (!s || s.value == null) return 0;
  if (typeof s.value === "string") {
    if (s.value.endsWith("%")) return Number(s.value.slice(0, -1)) || 0;
    return Number(s.value) || 0;
  }
  return Number(s.value) || 0;
}

export const getMatchPreview = createServerFn({ method: "GET" })
  .inputValidator((d: { homeId: number; awayId: number; last?: number }) => d)
  .handler(async ({ data }) => {
    const last = Math.min(Math.max(data.last ?? 5, 3), 8);

    async function teamAgg(teamId: number): Promise<TeamPreviewStats> {
      // Apenas os últimos 5 jogos de cada time (sem buscar histórico extra).
      const fx = (await apiGet("/fixtures", { team: teamId, last, timezone: TZ })) as ApiFixture[];
      const allFinished = fx.filter((f) => FINISHED_STATUSES.has(f.fixture.status.short));
      const finished = allFinished;

      const played = finished.length;
      const empty: TeamPreviewStats = {
        played: 0, goalsFor: 0, goalsAgainst: 0, goalsForAvg: 0, goalsAgainstAvg: 0,
        cornersFor: 0, cornersAgainst: 0, cornersForAvg: 0, cornersAgainstAvg: 0, cornersTotalAvg: 0,
        cornersSample: 0, cornersEstimated: false,
        shotsOnGoalAvg: 0, cardsAvg: 0, bttsPct: 0, over25Pct: 0,
        cleanSheetPct: 0, failedToScorePct: 0, form: "", lastResults: [],
      };
      if (played === 0) return empty;

      let gf = 0, ga = 0, btts = 0, over25 = 0, cs = 0, fs = 0;
      const form: string[] = [];
      const lastResults: TeamPreviewStats["lastResults"] = [];

      for (const f of finished) {
        const isHome = f.teams.home.id === teamId;
        const goalsFor = (isHome ? f.goals.home : f.goals.away) ?? 0;
        const goalsAg = (isHome ? f.goals.away : f.goals.home) ?? 0;
        gf += goalsFor; ga += goalsAg;
        if (goalsFor > 0 && goalsAg > 0) btts++;
        if (goalsFor + goalsAg > 2.5) over25++;
        if (goalsAg === 0) cs++;
        if (goalsFor === 0) fs++;
        form.push(goalsFor > goalsAg ? "V" : goalsFor < goalsAg ? "D" : "E");
        lastResults.push({
          date: f.fixture.date,
          opp: isHome ? f.teams.away.name : f.teams.home.name,
          gf: goalsFor, ga: goalsAg, home: isHome,
          result: goalsFor > goalsAg ? "V" : goalsFor < goalsAg ? "D" : "E",
        });
      }

      // Estatísticas (escanteios/chutes/cartões) — jogos encerrados nunca mudam → cache 24h.
      const allStats = await Promise.all(
        allFinished.map((f) =>
          (apiGet("/fixtures/statistics", { fixture: f.fixture.id }, 24 * 60 * 60_000) as Promise<ApiTeamStats[]>)
            .catch(() => [] as ApiTeamStats[])
        )
      );

      let cf = 0, ca = 0, shots = 0, cards = 0, cSample = 0, sSample = 0;
      for (let i = 0; i < allFinished.length; i++) {
        if (cSample >= last) break;
        const st = allStats[i];
        if (!st || st.length === 0) continue;
        const teamStat = st.find((s) => s.team.id === teamId);
        const oppStat = st.find((s) => s.team.id !== teamId);
        const hasCorner =
          teamStat?.statistics?.some((s) => s.type === "Corner Kicks" && s.value != null) ?? false;
        if (hasCorner) {
          cf += statNum(teamStat?.statistics, "Corner Kicks");
          ca += statNum(oppStat?.statistics, "Corner Kicks");
          cSample++;
        }
        shots += statNum(teamStat?.statistics, "Shots on Goal");
        cards += statNum(teamStat?.statistics, "Yellow Cards") + statNum(teamStat?.statistics, "Red Cards");
        sSample++;
      }

      // Sem nenhum dado de escanteio na liga → estimativa de média global.
      const cornersEstimated = cSample === 0;
      const forAvg = cornersEstimated ? 5 : +(cf / cSample).toFixed(1);
      const againstAvg = cornersEstimated ? 5 : +(ca / cSample).toFixed(1);

      return {
        played,
        goalsFor: gf, goalsAgainst: ga,
        goalsForAvg: +(gf / played).toFixed(2),
        goalsAgainstAvg: +(ga / played).toFixed(2),
        cornersFor: cf, cornersAgainst: ca,
        cornersForAvg: forAvg,
        cornersAgainstAvg: againstAvg,
        cornersTotalAvg: +(forAvg + againstAvg).toFixed(1),
        cornersSample: cSample,
        cornersEstimated,
        shotsOnGoalAvg: sSample ? +(shots / sSample).toFixed(1) : 0,
        cardsAvg: sSample ? +(cards / sSample).toFixed(1) : 0,
        bttsPct: Math.round((btts / played) * 100),
        over25Pct: Math.round((over25 / played) * 100),
        cleanSheetPct: Math.round((cs / played) * 100),
        failedToScorePct: Math.round((fs / played) * 100),
        form: form.reverse().join(""),
        lastResults: lastResults.slice(0, 5),
      };
    }


    type Preview = { home: TeamPreviewStats; away: TeamPreviewStats; last: number };
    // Grade recente (6h) + cópia de sobrevivência (7 dias). Assim, quando a
    // cota diária acaba, a página mostra a última grade boa em vez de vazia.
    const freshKey = `preview:${data.homeId}:${data.awayId}:${last}`;
    const keepKey = `${freshKey}#keep`;

    const fresh = (await getCachedData(freshKey).catch(() => null)) as Preview | null;
    if (fresh?.home && fresh?.away) return fresh;

    const [home, away] = await Promise.all([teamAgg(data.homeId), teamAgg(data.awayId)]);
    const out: Preview = { home, away, last };

    if (home.played > 0 || away.played > 0) {
      try {
        await setCachedData(freshKey, out, 6 * 60 * 60_000);
        await setCachedData(keepKey, out, 7 * 24 * 60 * 60_000);
      } catch {
        /* melhor esforço */
      }
      return out;
    }

    // Nada veio da API (cota esgotada/falha): devolve a última grade salva.
    const kept = (await getCachedData(keepKey).catch(() => null)) as Preview | null;
    return kept ?? out;
  });

// --- Types (subset of API-Football v3) ---
export interface ApiTeam {
  id: number;
  name: string;
  logo: string;
  winner?: boolean | null;
}
export interface ApiLeague {
  id: number;
  name: string;
  country: string;
  logo: string;
  flag: string | null;
  season: number;
  round: string;
}
export interface ApiFixture {
  fixture: {
    id: number;
    referee: string | null;
    timezone: string;
    date: string;
    timestamp: number;
    status: { long: string; short: string; elapsed: number | null };
    venue: { id: number | null; name: string | null; city: string | null };
  };
  league: ApiLeague;
  teams: { home: ApiTeam; away: ApiTeam };
  goals: { home: number | null; away: number | null };
  score: {
    halftime: { home: number | null; away: number | null };
    fulltime: { home: number | null; away: number | null };
    extratime: { home: number | null; away: number | null };
    penalty: { home: number | null; away: number | null };
  };
}
export interface ApiEvent {
  time: { elapsed: number; extra: number | null };
  team: ApiTeam;
  player: { id: number | null; name: string | null };
  assist: { id: number | null; name: string | null };
  type: string;
  detail: string;
  comments: string | null;
}
export interface ApiTeamStats {
  team: ApiTeam;
  statistics: { type: string; value: number | string | null }[];
}
export interface ApiLineupPlayer {
  player: { id: number; name: string; number: number; pos: string; grid: string | null };
}
export interface ApiLineup {
  team: ApiTeam;
  formation: string;
  startXI: ApiLineupPlayer[];
  substitutes: ApiLineupPlayer[];
  coach: { id: number; name: string; photo: string };
}
export interface ApiStandingRow {
  rank: number;
  team: ApiTeam;
  points: number;
  goalsDiff: number;
  group: string;
  form: string;
  status: string;
  description: string | null;
  all: { played: number; win: number; draw: number; lose: number; goals: { for: number; against: number } };
}
export interface ApiStandingsResp {
  league: { id: number; name: string; country: string; logo: string; flag: string; season: number; standings: ApiStandingRow[][] };
}

export interface ApiPrediction {
  predictions: {
    winner: { id: number | null; name: string | null; comment: string | null };
    win_or_draw: boolean;
    under_over: string | null;
    goals: { home: string | null; away: string | null };
    advice: string | null;
    percent: { home: string; draw: string; away: string };
  };
  teams: { home: ApiTeam; away: ApiTeam };
  comparison?: Record<string, { home: string; away: string }>;
  h2h?: ApiFixture[];
}

export interface ApiOddsBet {
  id: number;
  name: string;
  values: { value: string; odd: string }[];
}
export interface ApiOddsBookmaker {
  id: number;
  name: string;
  bets: ApiOddsBet[];
}
export interface ApiOddsResp {
  fixture: { id: number; timezone: string; date: string; timestamp: number };
  league: { id: number; name: string; country: string; logo: string; flag: string | null; season: number };
  bookmakers: ApiOddsBookmaker[];
}

// Live status codes per API-Football
export const LIVE_STATUSES = new Set(["1H", "2H", "HT", "ET", "BT", "P", "SUSP", "INT", "LIVE"]);
export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

/** Artilheiros / assistências de uma liga na temporada. */
export interface ApiPlayerStatRow {
  player: {
    id: number;
    name: string;
    firstname: string | null;
    lastname: string | null;
    age: number | null;
    nationality: string | null;
    photo: string;
  };
  statistics: {
    team: { id: number; name: string; logo: string };
    league: { id: number; name: string; country: string; logo: string; season: number };
    games: { appearences: number | null; minutes: number | null; position: string | null; rating: string | null };
    goals: { total: number | null; assists: number | null };
    shots: { total: number | null; on: number | null };
    penalty: { scored: number | null; missed: number | null };
    cards: { yellow: number | null; red: number | null };
  }[];
}

export const getTopScorers = createServerFn({ method: "GET" })
  .inputValidator((d: { league: number; season: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/players/topscorers", { league: data.league, season: data.season })) as ApiPlayerStatRow[];
  });

export const getTopAssists = createServerFn({ method: "GET" })
  .inputValidator((d: { league: number; season: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/players/topassists", { league: data.league, season: data.season })) as ApiPlayerStatRow[];
  });
