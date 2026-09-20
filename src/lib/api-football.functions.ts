import { createServerFn } from "@tanstack/react-start";
import { spendApiCall, readSnapshot, writeSnapshot, noteRemaining } from "./api-football-guard.server";

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
    // Se for hoje ou live, TTL baixíssimo (15s)
    const isToday = params.date === new Date().toISOString().split('T')[0];
    if (params.live === "all" || isToday || path === "/fixtures") return 60_000; // 1 min minimum even for live/today
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

export const getFixturesByDate = createServerFn({ method: "GET" })
  .inputValidator((d: { date: string }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures", { date: data.date, timezone: TZ })) as ApiFixture[];
  });

export const getLiveFixtures = createServerFn({ method: "GET" }).handler(async () => {
  return (await apiGet("/fixtures", { live: "all", timezone: TZ })) as ApiFixture[];
});

export const getNextFixturesToScan = createServerFn({ method: "GET" })
  .inputValidator((d: { count?: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures", { next: data.count ?? 50, timezone: TZ })) as ApiFixture[];
  });

export interface ApiStatus {
  account: { firstname: string; lastname: string; email: string };
  subscription: { plan: string; end: string; active: boolean };
  requests: { current: number; limit_day: number };
}
export const getApiStatus = createServerFn({ method: "GET" }).handler(async () => {
  const r = (await apiGet("/status")) as ApiStatus | unknown;
  return (r && typeof r === "object" && "requests" in (r as object) ? (r as ApiStatus) : null);
});

export const getFixture = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    const arr = (await apiGet("/fixtures", { id: data.id, timezone: TZ })) as ApiFixture[];
    return arr[0] ?? null;
  });

export const getFixtureEvents = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures/events", { fixture: data.id })) as ApiEvent[];
  });

export const getFixtureStatistics = createServerFn({ method: "GET" })
  .inputValidator((d: { id: number }) => d)
  .handler(async ({ data }) => {
    return (await apiGet("/fixtures/statistics", { fixture: data.id })) as ApiTeamStats[];
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

        for (let attempt = 1; attempt <= 3 && !json; attempt++) {
          await acquireSlot();
          try {
            const res = await fetch(cacheKey, {
              headers: { "x-apisports-key": key },
              signal: AbortSignal.timeout(15_000),
            });
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

    return Array.from(new Set(ids));
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


    const [home, away] = await Promise.all([teamAgg(data.homeId), teamAgg(data.awayId)]);
    return { home, away, last };
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
