/**
 * Módulo 3 — Motor server-only dos Bilhetes Automáticos (11 mercados).
 *
 * Estratégia de consumo controlado:
 *  - lote pequeno por execução (limite duro);
 *  - espaçamento entre jogos (sem picos de requisições);
 *  - lock de execução única gravado em `api_cache` (evita rodadas paralelas);
 *  - progresso persistido: cada jogo processado vira uma linha em `auto_tickets`,
 *    então uma nova execução só pega o que falta (carga incremental).
 */
import type { ApiFixture, TeamPreviewStats } from "./api-football.functions";
import { upcomingFixtures, recentFinishedIndex } from "./api-football-raw.server";
import { computeOwnPrediction } from "./own-prediction";
import {
  buildAutoPicks,
  gradeAutoPicks,
  readMatchNarrative,
  resultReason,
  topExactScores,
  type AutoPick,
  type MatchResult,
} from "./auto-ticket";
import { mergeEliteMin, type PillarInput, type PillarReferee } from "./five-pillars";

const LOCK_KEY = "auto_tickets_lock";
const LOCK_TTL_MS = 4 * 60 * 1000;
const GRADE_THROTTLE_KEY = "auto_tickets_grade_throttle";
const GRADE_INTERVAL_MS = 30 * 60 * 1000; // conferência: 1x a cada 30 min
const SCAN_THROTTLE_KEY = "auto_tickets_scan_throttle";
const SCAN_INTERVAL_MS = 15 * 60 * 1000; // varredura: 1x a cada 15 min
const GAP_MS = 150; // espacamento entre jogos (plano Pro)
const HORIZON_HOURS = 24;
const CORNERS_AVG = 5.0; // estimativa quando não há estatística disponível
const CARDS_AVG = 2.0;

// ── Loader dos mínimos do Filtro de Elite (ai_weights, cacheado 15 min) ──
let eliteMinCache: { at: number; min: Record<string, number> } | null = null;
async function loadEliteMin(): Promise<Record<string, number>> {
  const now = Date.now();
  if (eliteMinCache && now - eliteMinCache.at < 15 * 60 * 1000) return eliteMinCache.min;
  let db: Record<string, number> | null | undefined;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("ai_weights")
      .select("weights")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const w =
      (data?.weights as unknown as { minimum_scores?: Record<string, number> } | null) ?? null;
    db = w?.minimum_scores ?? null;
  } catch (e) {
    console.warn("[auto-tickets] loadEliteMin failed", (e as Error).message);
  }
  eliteMinCache = { at: now, min: mergeEliteMin(db) };
  return eliteMinCache.min;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Monta as médias de um time a partir do índice de jogos encerrados recentes. */
function teamStatsFromIndex(
  teamId: number,
  idx: Map<number, ApiFixture[]>,
  last = 5,
): TeamPreviewStats {
  const games = (idx.get(teamId) ?? []).slice(0, last);
  const empty: TeamPreviewStats = {
    played: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalsForAvg: 0,
    goalsAgainstAvg: 0,
    cornersFor: 0,
    cornersAgainst: 0,
    cornersForAvg: 0,
    cornersAgainstAvg: 0,
    cornersTotalAvg: 0,
    cornersSample: 0,
    cornersEstimated: true,
    shotsOnGoalAvg: 0,
    cardsAvg: CARDS_AVG,
    bttsPct: 0,
    over25Pct: 0,
    cleanSheetPct: 0,
    failedToScorePct: 0,
    form: "",
    lastResults: [],
  };
  if (!games.length) return empty;

  let gf = 0,
    ga = 0,
    btts = 0,
    over25 = 0,
    cs = 0,
    fs = 0;
  const form: string[] = [];
  const lastResults: TeamPreviewStats["lastResults"] = [];
  for (const f of games) {
    const isHome = f.teams.home.id === teamId;
    const goalsFor = (isHome ? f.goals.home : f.goals.away) ?? 0;
    const goalsAg = (isHome ? f.goals.away : f.goals.home) ?? 0;
    gf += goalsFor;
    ga += goalsAg;
    if (goalsFor > 0 && goalsAg > 0) btts++;
    if (goalsFor + goalsAg > 2.5) over25++;
    if (goalsAg === 0) cs++;
    if (goalsFor === 0) fs++;
    const result = goalsFor > goalsAg ? "V" : goalsFor < goalsAg ? "D" : "E";
    form.push(result);
    lastResults.push({
      date: f.fixture.date,
      opp: isHome ? f.teams.away.name : f.teams.home.name,
      gf: goalsFor,
      ga: goalsAg,
      home: isHome,
      result,
    });
  }
  const n = games.length;
  return {
    played: n,
    goalsFor: gf,
    goalsAgainst: ga,
    goalsForAvg: gf / n,
    goalsAgainstAvg: ga / n,
    cornersFor: 0,
    cornersAgainst: 0,
    cornersForAvg: CORNERS_AVG,
    cornersAgainstAvg: CORNERS_AVG,
    cornersTotalAvg: CORNERS_AVG * 2,
    cornersSample: 0,
    cornersEstimated: true,
    shotsOnGoalAvg: 0,
    cardsAvg: CARDS_AVG,
    bttsPct: btts / n,
    over25Pct: over25 / n,
    cleanSheetPct: cs / n,
    failedToScorePct: fs / n,
    form: form.join(""),
    lastResults,
  };
}

export interface AutoTicketsProgress {
  ok: boolean;
  total: number;
  done: number;
  processed: number;
  graded: number;
  progress: number; // 0..100
  skipped?: string;
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function acquireLock(): Promise<boolean> {
  const db = await admin();
  const now = new Date();
  const { data } = await db
    .from("api_cache")
    .select("expires_at")
    .eq("key", LOCK_KEY)
    .maybeSingle();
  if (data?.expires_at && new Date(data.expires_at).getTime() > now.getTime()) return false;
  await db.from("api_cache").upsert({
    key: LOCK_KEY,
    data: { at: now.toISOString() },
    expires_at: new Date(now.getTime() + LOCK_TTL_MS).toISOString(),
  });
  return true;
}

async function releaseLock() {
  const db = await admin();
  await db
    .from("api_cache")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("key", LOCK_KEY);
}

/**
 * Trava de frequência persistida em `api_cache`: devolve true (e renova a janela)
 * apenas quando o intervalo mínimo já passou desde a última execução.
 */
async function throttleGate(key: string, windowMs: number): Promise<boolean> {
  const db = await admin();
  const now = Date.now();
  const { data } = await db.from("api_cache").select("expires_at").eq("key", key).maybeSingle();
  if (data?.expires_at && new Date(data.expires_at).getTime() > now) return false;
  await db.from("api_cache").upsert({
    key,
    data: { at: new Date(now).toISOString() },
    expires_at: new Date(now + windowMs).toISOString(),
  });
  return true;
}

/** Executa um lote controlado: gera bilhetes dos próximos jogos e confere os encerrados. */
export async function runAutoTicketsBatch(limit = 500): Promise<AutoTicketsProgress> {
  if (!(await acquireLock())) {
    const snap = await snapshotProgress();
    return { ...snap, ok: true, processed: 0, graded: 0, skipped: "lock" };
  }

  let processed = 0;
  let graded = 0;
  try {
    const db = await admin();

    // 0) Manutenção: remove chaves de cache já expiradas (evita acúmulo).
    await purgeExpiredCache().catch(() => 0);

    // 1) Conferência em lote — no máximo 1 vez a cada 30 minutos.
    if (await throttleGate(GRADE_THROTTLE_KEY, GRADE_INTERVAL_MS)) {
      graded = await gradePending(400);
      if (graded > 0) {
        const { AUTO_MARKETS } = await import("./auto-ticket");
        await persistMarketRanking(AUTO_MARKETS).catch(() => []);
      }
    }

    // 2) Varredura (geração) — no máximo 1 vez a cada 15 minutos.
    if (!(await throttleGate(SCAN_THROTTLE_KEY, SCAN_INTERVAL_MS))) {
      const snap = await snapshotProgress();
      return { ...snap, ok: true, processed: 0, graded, skipped: "throttle" };
    }
    const genBudget = limit;

    const upcoming = await upcomingFixtures(HORIZON_HOURS);

    const ids = upcoming.map((f) => f.fixture.id);
    const known = new Set<number>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: existing } = await db
        .from("auto_tickets")
        .select("fixture_id")
        .in("fixture_id", ids.slice(i, i + 200));
      for (const r of existing ?? []) known.add(Number(r.fixture_id));
    }

    const pending = upcoming.filter((f) => !known.has(f.fixture.id));

    const scans: Record<string, unknown>[] = [];

    if (pending.length && genBudget > 0) {
      const idx = await recentFinishedIndex(12);
      for (const fx of pending.slice(0, genBudget)) {
        try {
          const built = await buildRow(fx, idx);
          if (built) {
            const { scan, triagem, triagemMeta, ...row } = built;
            await db.from("auto_tickets").upsert(row, { onConflict: "fixture_id" });
            if (triagem.length && triagemMeta) {
              const { saveTriagem } = await import("./triagem.server");
              await saveTriagem(triagem, triagemMeta).catch(() => 0);
            }
            scans.push({
              fixture_id: scan.fixtureId,
              market: "scan_snapshot",
              // linha dinâmica de gols escolhida para esta partida
              market_sub_type: scan.goalsSubType ?? null,
              probability: Math.round((scan.bestProb ?? 0) * 100),
              score: 0,
              features: scan as unknown as never,
            });
          } else {
            // Sem amostra suficiente: registra como "skipped" para não travar o progresso.
            await db.from("auto_tickets").upsert(
              {
                fixture_id: fx.fixture.id,
                kickoff: fx.fixture.date,
                league: `${fx.league.country ?? ""} · ${fx.league.name}`.replace(/^ · /, ""),
                home: fx.teams.home.name,
                away: fx.teams.away.name,
                home_logo: fx.teams.home.logo,
                away_logo: fx.teams.away.logo,
                picks: [] as unknown as never,
                meta: {} as unknown as never,
                status: "skipped",
              },
              { onConflict: "fixture_id" },
            );
          }
          processed++;
        } catch (e) {
          console.warn("[auto-tickets] falha ao gerar", fx.fixture.id, (e as Error).message);
        }
        await sleep(GAP_MS);
      }
    }

    // Persiste os selos da varredura em blocos pequenos (um bloco grande falhava em silêncio).
    const savedScans = await persistScanSnapshots(scans);

    // Recuperação: jogos futuros que já têm bilhete mas ficaram sem selo.
    const backfilled = await backfillScanSnapshots(600).catch((e) => {
      console.warn("[auto-tickets] backfill falhou", (e as Error).message);
      return 0;
    });

    // Registra a rodada da varredura (histórico/diagnóstico).
    await db.from("ai_rounds").insert({
      slot: (() => {
        const h = new Date().getUTCHours();
        return h < 12 ? "morning" : h < 18 ? "afternoon" : "night";
      })(),
      status: "done",
      fixtures_analyzed: processed,
      notes: `graded=${graded} scans=${savedScans}/${scans.length} backfill=${backfilled}`,
    } as never);

    const total = upcoming.length;
    const done = Math.min(total, known.size + processed);
    return {
      ok: true,
      total,
      done,
      processed,
      graded,
      progress: total ? Math.round((done / total) * 100) : 100,
    };
  } finally {
    await releaseLock();
  }
}

const SNAPSHOT_CHUNK = 50;

/** Mantém a probabilidade dentro de 0..100 (a coluna não aceita valores maiores). */
function clampPct(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Grava os selos em blocos pequenos (delete + insert por bloco), com repetição
 * sem `market_sub_type` quando a coluna não existir. Retorna quantos foram salvos.
 */
async function persistScanSnapshots(rows: Record<string, unknown>[]): Promise<number> {
  if (!rows.length) return 0;
  const db = await admin();
  let saved = 0;
  for (let i = 0; i < rows.length; i += SNAPSHOT_CHUNK) {
    const chunk = rows.slice(i, i + SNAPSHOT_CHUNK);
    const ids = chunk.map((s) => Number(s["fixture_id"]));
    try {
      await db.from("ai_predictions").delete().eq("market", "scan_snapshot").in("fixture_id", ids);
      const { error } = await db.from("ai_predictions").insert(chunk as never);
      if (error) {
        const legacy = chunk.map(({ market_sub_type: _omit, ...rest }) => rest);
        const { error: legacyErr } = await db.from("ai_predictions").insert(legacy as never);
        if (legacyErr) {
          console.error("[auto-tickets] selos não gravados", ids.length, legacyErr.message);
          continue;
        }
      }
      saved += chunk.length;
    } catch (e) {
      console.error("[auto-tickets] selos não gravados (exceção)", (e as Error).message);
    }
  }
  return saved;
}

/**
 * Reconstrói os selos de jogos futuros que já têm bilhete montado mas ficaram sem
 * snapshot (falha silenciosa em rodadas grandes). Usa apenas dados já salvos no
 * banco — zero requisições à API-Football.
 */
export async function backfillScanSnapshots(limit = 600): Promise<number> {
  const db = await admin();
  const now = new Date().toISOString();
  const horizon = new Date(Date.now() + HORIZON_HOURS * 60 * 60 * 1000).toISOString();

  const { data: tickets } = await db
    .from("auto_tickets")
    .select("fixture_id, kickoff, league, home, away, picks, meta")
    .gt("kickoff", now)
    .lt("kickoff", horizon)
    .eq("status", "pending")
    .order("kickoff", { ascending: true })
    .limit(limit);
  const rows = (tickets ?? []).filter((r) => Array.isArray(r.picks) && (r.picks as unknown[]).length);
  if (!rows.length) return 0;

  const ids = rows.map((r) => Number(r.fixture_id));
  const have = new Set<number>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data: existing } = await db
      .from("ai_predictions")
      .select("fixture_id")
      .eq("market", "scan_snapshot")
      .in("fixture_id", ids.slice(i, i + 200));
    for (const r of existing ?? []) have.add(Number(r.fixture_id));
  }

  const missing = rows.filter((r) => !have.has(Number(r.fixture_id)));
  console.log("[backfill] candidatos", rows.length, "com selo", have.size, "faltando", missing.length);
  if (!missing.length) return 0;

  const scans = missing.map((r) => {
    const picks = (r.picks as { market: string; selection: string; prob: number; score?: number | null; elite?: boolean | null }[]) ?? [];
    const meta = (r.meta ?? {}) as { goalsSubType?: string | null; eliteMin?: Record<string, number> };
    const raw = picks.reduce((m, p) => (typeof p.prob === "number" && p.prob > m ? p.prob : m), 0);
    // picks antigos podem ter prob em % (0..100); normaliza sempre para 0..1
    const bestProb = raw > 1 ? raw / 100 : raw;
    return {
      fixture_id: Number(r.fixture_id),
      market: "scan_snapshot",
      market_sub_type: meta.goalsSubType ?? null,
      probability: clampPct(bestProb * 100),
      score: 0,
      features: {
        fixtureId: Number(r.fixture_id),
        kickoff: r.kickoff,
        home: r.home,
        away: r.away,
        league: r.league,
        goalsSubType: meta.goalsSubType ?? null,
        bestProb,
        picks,
        pillarContext: { eliteMin: meta.eliteMin ?? {} },
      } as unknown as never,
    } as Record<string, unknown>;
  });

  return persistScanSnapshots(scans);
}


async function buildRow(fx: ApiFixture, idx: Map<number, ApiFixture[]>) {
  const home = teamStatsFromIndex(fx.teams.home.id, idx);
  const away = teamStatsFromIndex(fx.teams.away.id, idx);
  if (!home.played || !away.played) return null;

  const pred = computeOwnPrediction(home, away);
  if (!pred.ready) return null;

  // 5 Pilares — contexto alimentado SEM novas chamadas de API:
  // L10 (últimos 10 jogos do índice), árbitro (nome do fixture) e H2H neutro.
  const home10 = teamStatsFromIndex(fx.teams.home.id, idx, 10);
  const away10 = teamStatsFromIndex(fx.teams.away.id, idx, 10);
  const referee: PillarReferee = {
    name: fx.fixture.referee ?? null,
    cardsPerGame: null, // sem banco de arbitragem → P3 neutro até haver estatísticas
    foulsPerGame: null,
    n: 0,
  };
  const elites = await loadEliteMin();

  const ctx = {
    homeName: fx.teams.home.name,
    awayName: fx.teams.away.name,
    cornersOver95: pred.pCornersOver95,
    cardsOver45: Math.min(0.95, Math.max(0.05, (home.cardsAvg + away.cardsAvg) / 9)),
    pillars: {
      home: home10,
      away: away10,
      pred,
      referee,
      h2h: null, // pressionar o H2H na varredura custaria 1 chamada/jogo → evitado (P4 neutro)
    } as PillarInput,
    eliteMin: elites,
  };
  const narrative = readMatchNarrative(pred, ctx);
  const picks = buildAutoPicks(pred, ctx);
  if (!picks.length) return null;

  // Filtro de Elite: a aposta (auto_tickets.picks) só emite palpite com
  // score ≥ mínimo do mercado. Os demais continuam no scan (selos com score).
  const bet = picks.filter((p) => p.elite !== false);
  const emitted: AutoPick[] = bet.length ? bet : [];
  const status = emitted.length ? "pending" : "skipped";

  const goalsSubType = picks.find((p) => p.market === "Gols Dinâmico")?.subType ?? null;

  // Triagem — avalia TODOS os 9 mercados (publica nota >= 75; reprovados são auditados).
  const triagemMeta = {
    fixtureId: fx.fixture.id,
    matchName: `${fx.teams.home.name} x ${fx.teams.away.name}`,
    league: `${fx.league.country ?? ""} · ${fx.league.name}`.replace(/^ · /, ""),
    kickoff: fx.fixture.date,
    homeGoalsForAvgL10: home10.goalsForAvg,
    awayGoalsForAvgL10: away10.goalsForAvg,
    homeCleanSheetPct: home10.cleanSheetPct,
    awayCleanSheetPct: away10.cleanSheetPct,
  };
  const { evaluateTriagem } = await import("./triagem-engine");
  const triagem = evaluateTriagem(pred, triagemMeta);

  const scan = {
    fixtureId: fx.fixture.id,
    goalsSubType,
    pUnder15: pred.pUnder15,
    pOver15: pred.pOver15,
    pUnder25: pred.pUnder25,
    pOver25: pred.pOver25,
    pBTTS: pred.pBTTS,
    pNoBTTS: pred.pNoBTTS,
    pCornersOver95: pred.pCornersOver95,
    bestProb: Math.max(pred.pUnder15, pred.pOver25, pred.pBTTS, pred.pCornersOver95),
    kickoff: fx.fixture.date,
    home: fx.teams.home.name,
    away: fx.teams.away.name,
    league: `${fx.league.country ?? ""} · ${fx.league.name}`.replace(/^ · /, ""),
    // Contexto dos 5 Pilares (exibido no front-end com os selos).
    pillarContext: {
      referee: referee.name,
      homeL10: home10.lastResults?.length ? `${l10Str(home10)}` : null,
      awayL10: away10.lastResults?.length ? `${l10Str(away10)}` : null,
      eliteMin: elites,
    },
    // Todos os mercados do bilhete automático + placar exato mais provável (sempre presente
    // para os selos aparecerem automaticamente nos cards, mesmo quando não é publicado).
    picks: (() => {
      const lite = picks.map((p) => ({
        market: p.market,
        selection: p.selection,
        prob: p.prob,
        score: p.score ?? null,
        elite: p.elite ?? null,
        notes: p.pillarNotes ?? null,
      }));
      const top = topExactScores(pred.matrix)[0];
      if (top) {
        const entry = {
          market: "Placar Exato Seco",
          selection: `${top.i} - ${top.j}`,
          prob: top.p,
          score: null,
          elite: null,
          notes: null,
        };
        const x = lite.findIndex((p) => p.market === "Placar Exato Seco");
        if (x >= 0) lite[x] = entry;
        else lite.push(entry);
      }
      return lite;
    })(),
  };

  return {
    scan,
    triagem,
    triagemMeta,

    fixture_id: fx.fixture.id,
    kickoff: fx.fixture.date,
    league: `${fx.league.country ?? ""} · ${fx.league.name}`.replace(/^ · /, ""),
    home: fx.teams.home.name,
    away: fx.teams.away.name,
    home_logo: fx.teams.home.logo,
    away_logo: fx.teams.away.logo,
    picks: emitted as unknown as never,
    meta: {
      lambdaHome: pred.lambdaHome,
      lambdaAway: pred.lambdaAway,
      expectedGoals: pred.expectedGoals,
      expectedCorners: pred.expectedCorners,
      sampleHome: home.played,
      sampleAway: away.played,
      headline: narrative.headline,
      flow: narrative.flow,
      goalsSubType,
      eliteMin: elites,
      // cluster de proteção (top 3 placares) usado pelos mercados de placar exato
      scoreCluster: (() => {
        const multi = picks.find((p) => p.market === "Placar Múltiplo Exato");
        return multi && multi.rule.t === "scores"
          ? multi.rule.list.map(([i, j]) => `${i}-${j}`)
          : [];
      })(),
    } as unknown as never,

    status,
  };
}

/** L10 legível (ex.: "O2.5 60% BTTS 40%") — sem import circular de five-pillars. */
function l10Str(t: TeamPreviewStats): string {
  const n = t.lastResults.length;
  const over25 = t.lastResults.filter((r) => r.gf + r.ga > 2.5).length / n;
  const btts = t.lastResults.filter((r) => r.gf > 0 && r.ga > 0).length / n;
  return `L10 n=${n} O2.5 ${(over25 * 100) | 0}% BTTS ${(btts * 100) | 0}%`;
}

/** Quantos bilhetes pendentes já passaram do apito final (fila de conferência). */
export async function overduePendingCount(): Promise<number> {
  const db = await admin();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { count } = await db
    .from("auto_tickets")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lt("kickoff", cutoff);
  return count ?? 0;
}

/** Data (São Paulo) de um kickoff ISO — usada para agrupar a conferência por dia. */
function spDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/**
 * Conferência em LOTE: primeiro varre as datas com `finishedFixturesByDate`
 * (1 requisição por data, cacheada), depois faz fallback individual via
 * `fixtureById` (requisição única, cacheada em `api_cache`/snapshot) para os
 * jogos que não apareceram no lote. Cada jogo encerrado vira `graded` com o
 * resultado real; escanteios/cartões só são buscados quando o bilhete tem esses
 * mercados e dentro do `SCOUT_BUDGET_PER_RUN`.
 */
export async function gradePending(limit = 400): Promise<number> {
  const db = await admin();
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await db
    .from("auto_tickets")
    .select("id, fixture_id, picks, kickoff, home, away")
    .eq("status", "pending")
    .lt("kickoff", cutoff)
    .order("kickoff", { ascending: true })
    .limit(Math.max(limit, 50));

  const pending = rows ?? [];
  if (!pending.length) return 0;

  // Orçamento de scout (escanteios/cartões) por execução — protege a cota diária.
  let scoutBudget = Number(process.env["SCOUT_BUDGET_PER_RUN"] ?? 40);
  if (!Number.isFinite(scoutBudget) || scoutBudget < 0) scoutBudget = 40;

  /** Confere um jogo já encerrado contra o bilhete e grava o status final. */
  const gradeGame = async (row: (typeof pending)[number], fx: ApiFixture): Promise<boolean> => {
    // Escanteios/cartões: só busca o scout quando o bilhete tem esses mercados
    // e dentro de um orçamento por execução (protege a cota da API).
    const rowPicks = (row.picks ?? []) as unknown as AutoPick[];
    const needsScout = rowPicks.some(
      (p) =>
        p?.rule?.t === "corners" ||
        p?.rule?.t === "cards" ||
        (p?.rule?.t === "combo" && p.rule.legs.some((l) => l.t === "corners" || l.t === "cards")),
    );
    let scout: { corners: number | null; cards: number | null } = { corners: null, cards: null };
    if (needsScout && scoutBudget > 0) {
      scoutBudget--;
      try {
        const { fixtureScout } = await import("./api-football-raw.server");
        scout = await fixtureScout(Number(row.fixture_id));
      } catch (e) {
        console.warn("[auto-tickets] scout indisponível", row.fixture_id, (e as Error).message);
      }
      await sleep(GAP_MS);
    }

    const result: MatchResult = {
      goalsH: fx.goals.home ?? 0,
      goalsA: fx.goals.away ?? 0,
      htH: fx.score.halftime.home,
      htA: fx.score.halftime.away,
      corners: scout.corners,
      cards: scout.cards,
      firstGoal: null,
      homeName: String(row.home ?? "Casa"),
      awayName: String(row.away ?? "Fora"),
    };

    const g = gradeAutoPicks(rowPicks, result);
    const { error } = await db
      .from("auto_tickets")
      .update({
        picks: g.picks as unknown as never,
        status: "graded",
        result: result as unknown as never,
        result_snapshot: {
          home_score: result.goalsH,
          away_score: result.goalsA,
          ht_home_score: result.htH ?? null,
          ht_away_score: result.htA ?? null,
          total_corners: result.corners ?? null,
          total_cards: result.cards ?? null,
          first_goal: null,
          reason: resultReason(result),
        } as unknown as never,
        greens: g.greens,
        reds: g.reds,
        accuracy: g.accuracy,
        graded_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (error) {
      console.warn("[auto-tickets] falha ao gravar conferência", row.fixture_id, error.message);
      return false;
    }

    // Conferência independente da Triagem (cada mercado isolado).
    try {
      const { gradeTriagemFixture } = await import("./triagem.server");
      await gradeTriagemFixture(Number(row.fixture_id), result.goalsH, result.goalsA);
    } catch (e) {
      console.warn("[triagem] conferência falhou", row.fixture_id, (e as Error).message);
    }

    return true;
  };

  // Agrupa por data (SP) e processa primeiro as datas mais antigas, que são as
  // que já tiveram tempo de encerrar. Cada data = 1 requisição à API-Football.
  const byDate = new Map<string, typeof pending>();
  for (const r of pending) {
    const d = spDate(String(r.kickoff));
    const arr = byDate.get(d) ?? [];
    arr.push(r);
    byDate.set(d, arr);
  }
  const dates = [...byDate.keys()].sort().slice(0, 8);

  let graded = 0;
  const matched = new Set<string>();

  for (const date of dates) {
    const { finishedFixturesByDate } = await import("./api-football-raw.server");
    let finished: ApiFixture[] = [];
    try {
      finished = await finishedFixturesByDate(date);
    } catch (e) {
      console.warn("[auto-tickets] falha ao buscar encerrados", date, (e as Error).message);
      continue;
    }
    const map = new Map<number, ApiFixture>();
    for (const f of finished) map.set(f.fixture.id, f);

    for (const row of byDate.get(date) ?? []) {
      const fx = map.get(Number(row.fixture_id));
      if (!fx) continue; // deixa para o fallback individual abaixo
      matched.add(row.id);
      if (await gradeGame(row, fx)) graded++;
    }
  }

  // Fallback individual: jogos que não apareceram no lote por data são buscados
  // pelo id (requisição única, cacheada). Só tenta quando já houve tempo
  // suficiente para o apito final e respeitando um teto de buscas por execução
  // (protege a cota diária compartilhada do site).
  const INDIVIDUAL_AFTER_MS = 3 * 60 * 60 * 1000;
  const missedCount = pending.length - matched.size;
  const fallbackBudget = Math.min(Math.max(missedCount, 10), 80);
  const { fixtureById } = await import("./api-football-raw.server");
  let tried = 0;
  for (const row of pending) {
    if (matched.has(row.id)) continue;
    const age = Date.now() - new Date(row.kickoff as string).getTime();
    if (age < INDIVIDUAL_AFTER_MS) continue;
    if (tried >= fallbackBudget) break;
    tried++;
    let fx: ApiFixture | null = null;
    try {
      fx = await fixtureById(Number(row.fixture_id));
    } catch (e) {
      console.warn("[auto-tickets] fallback indisponível", row.fixture_id, (e as Error).message);
    }
    await sleep(GAP_MS);
    if (!fx) {
      // Sem retorno 12h+ após o kickoff: anula (dado indisponível) para não
      // manter bilhetes pendentes para sempre.
      if (age > 12 * 60 * 60 * 1000) {
        await db
          .from("auto_tickets")
          .update({ status: "void", graded_at: new Date().toISOString() })
          .eq("id", row.id);
      }
      continue;
    }
    const short = fx.fixture.status.short;
    if (short !== "FT" && short !== "AET" && short !== "PEN") continue; // segue pendente até encerrar
    matched.add(row.id);
    if (await gradeGame(row, fx)) graded++;
  }

  // Fecha as triagens pendentes de jogos já encerrados usando o placar salvo
  // (não gasta API) — inclusive as que ficaram para trás em execuções antigas.
  try {
    const { gradeTriagemBacklog } = await import("./triagem.server");
    await gradeTriagemBacklog();
  } catch (e) {
    console.warn("[triagem] backlog falhou", (e as Error).message);
  }

  return graded;
}

/** Progresso sem gastar chamadas da API-Football. */
export async function snapshotProgress(): Promise<AutoTicketsProgress> {
  const db = await admin();
  const now = new Date();
  const horizon = new Date(now.getTime() + HORIZON_HOURS * 60 * 60 * 1000);
  const { count } = await db
    .from("auto_tickets")
    .select("id", { count: "exact", head: true })
    .gte("kickoff", now.toISOString())
    .lte("kickoff", horizon.toISOString());
  const done = count ?? 0;
  return { ok: true, total: done, done, processed: 0, graded: 0, progress: done ? 100 : 0 };
}

/** Remove chaves de cache vencidas (evita leitura desatualizada e inchaço da tabela). */
export async function purgeExpiredCache(): Promise<number> {
  const db = await admin();
  const { data } = await db
    .from("api_cache")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("key");
  return (data ?? []).length;
}

/* ============================================================
 * RANKING DE MERCADOS (conferência automática)
 * Consolida green/red/void por mercado e guarda um retrato em
 * `api_cache` a cada conferência — leitura instantânea no painel.
 * ========================================================== */
export interface MarketRankingRow {
  market: string;
  total: number;
  greens: number;
  reds: number;
  voids: number;
  accuracy: number;
  recentGreens: number;
  recentReds: number;
  recentAccuracy: number;
  verdict: "otimo" | "bom" | "atencao" | "ruim" | "sem-dados";
}

const RANKING_KEY = "market_ranking_snapshot";
const RECENT_DAYS = 14;

function verdictOf(g: number, r: number, acc: number): MarketRankingRow["verdict"] {
  const n = g + r;
  if (n < 5) return "sem-dados";
  if (acc >= 0.65) return "otimo";
  if (acc >= 0.55) return "bom";
  if (acc >= 0.45) return "atencao";
  return "ruim";
}

/** Recalcula o ranking a partir de todos os bilhetes já conferidos. */
export async function computeMarketRanking(
  markets: readonly string[] = [],
): Promise<MarketRankingRow[]> {
  const db = await admin();
  const recentCut = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000;
  const agg = new Map<string, { g: number; r: number; v: number; rg: number; rr: number }>();
  const bump = (m: string) => {
    const cur = agg.get(m) ?? { g: 0, r: 0, v: 0, rg: 0, rr: 0 };
    agg.set(m, cur);
    return cur;
  };
  for (const m of markets) bump(m);

  const page = 500;
  for (let i = 0; i < 40; i++) {
    const { data, error } = await db
      .from("auto_tickets")
      .select("picks, graded_at")
      .eq("status", "graded")
      .order("graded_at", { ascending: false })
      .range(i * page, i * page + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as {
      picks: { market: string; status?: string }[];
      graded_at: string | null;
    }[];
    for (const row of rows) {
      const isRecent = row.graded_at ? new Date(row.graded_at).getTime() >= recentCut : false;
      for (const p of row.picks ?? []) {
        if (!p?.market) continue;
        const cur = bump(p.market);
        if (p.status === "green") {
          cur.g++;
          if (isRecent) cur.rg++;
        } else if (p.status === "red") {
          cur.r++;
          if (isRecent) cur.rr++;
        } else cur.v++;
      }
    }
    if (rows.length < page) break;
  }

  const out: MarketRankingRow[] = [...agg.entries()].map(([market, v]) => {
    const accuracy = v.g + v.r ? v.g / (v.g + v.r) : 0;
    const recentAccuracy = v.rg + v.rr ? v.rg / (v.rg + v.rr) : 0;
    return {
      market,
      total: v.g + v.r + v.v,
      greens: v.g,
      reds: v.r,
      voids: v.v,
      accuracy,
      recentGreens: v.rg,
      recentReds: v.rr,
      recentAccuracy,
      verdict: verdictOf(v.g, v.r, accuracy),
    };
  });

  out.sort((a, b) => {
    const an = a.greens + a.reds,
      bn = b.greens + b.reds;
    if (!an && bn) return 1;
    if (an && !bn) return -1;
    return b.accuracy - a.accuracy || bn - an;
  });
  return out;
}

/** Guarda o retrato do ranking (histórico automático de desempenho). */
export async function persistMarketRanking(
  markets: readonly string[] = [],
): Promise<MarketRankingRow[]> {
  const rows = await computeMarketRanking(markets);
  const db = await admin();
  await db.from("api_cache").upsert({
    key: RANKING_KEY,
    data: { at: new Date().toISOString(), rows } as unknown as never,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  return rows;
}

/** Último retrato salvo (sem recalcular) — usado como leitura rápida. */
export async function readMarketRankingSnapshot(): Promise<{
  at: string | null;
  rows: MarketRankingRow[];
}> {
  const db = await admin();
  const { data } = await db.from("api_cache").select("data").eq("key", RANKING_KEY).maybeSingle();
  const payload = (data?.data ?? null) as { at?: string; rows?: MarketRankingRow[] } | null;
  return { at: payload?.at ?? null, rows: payload?.rows ?? [] };
}
