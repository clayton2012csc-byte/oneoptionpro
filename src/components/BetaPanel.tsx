import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlaskConical, Loader2, ChevronDown, ChevronUp, RotateCw, Save, Trash2, Check, Sparkles } from "lucide-react";
import {
  getFixture,
  getTeamSeasonStatistics,
  getTeamRecentFixtures,
  getFixtureStatistics,
  type ApiFixture,
  type ApiTeamSeasonStats,
} from "@/lib/api-football.functions";
import { usePinnedSections } from "@/lib/pinned-sections";
import { listFechamentos, saveFechamento, deleteFechamento, type Fechamento } from "@/lib/fechamentos";
import { useTriagemView, triagemMinFor } from "@/lib/triagem-view";

const TRIAGEM_TAG: Record<string, string> = {
  under_1_5: "U1.5",
  over_1_5: "O1.5",
  ambas_sim: "BTTS SIM",
  ambas_nao: "BTTS NÃO",
  placar_exato: "PLACAR",
  casa_vence: "CASA",
  empate_com_gol: "EMPATE C/GOL",
  empate_sem_gols: "EMPATE 0X0",
  visitante_ganha: "FORA",
};

// ---------- Poisson helpers ----------
function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}
function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial(k);
}
function scoreMatrix(lh: number, la: number, max = 8): number[][] {
  const m: number[][] = [];
  for (let i = 0; i <= max; i++) {
    m[i] = [];
    for (let j = 0; j <= max; j++) m[i][j] = poisson(lh, i) * poisson(la, j);
  }
  return m;
}
function num(v: string | number | null | undefined, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : v ?? fallback;
  return isFinite(n as number) ? (n as number) : fallback;
}

type BetaEnriched = {
  id: number;
  fixture: ApiFixture | null;
  homeStats: ApiTeamSeasonStats | null;
  awayStats: ApiTeamSeasonStats | null;
  lambdaHome: number;
  lambdaAway: number;
  lambdaTotal: number;
  matrix: number[][];
  pOver15: number;
  pOver25: number;
  pOver35: number;
  pUnder15: number;
  pUnder25: number;
  pUnder35: number;
  pBTTS: number;
  pNoBTTS: number;
  pHomeWin: number;
  pDraw: number;
  pAwayWin: number;
  ready: boolean;
};

function computePoisson(fx: ApiFixture | null, home: ApiTeamSeasonStats | null, away: ApiTeamSeasonStats | null): Omit<BetaEnriched, "id" | "fixture" | "homeStats" | "awayStats"> {
  if (!fx || !home || !away) {
    return { lambdaHome: 0, lambdaAway: 0, lambdaTotal: 0, matrix: [], pOver15: 0, pOver25: 0, pOver35: 0, pUnder15: 0, pUnder25: 0, pUnder35: 0, pBTTS: 0, pNoBTTS: 0, pHomeWin: 0, pDraw: 0, pAwayWin: 0, ready: false };
  }
  const homeFor = num(home.goals.for.average.home, 1.3);
  const homeAgainst = num(home.goals.against.average.home, 1.2);
  const awayFor = num(away.goals.for.average.away, 1.1);
  const awayAgainst = num(away.goals.against.average.away, 1.3);
  let lh = (homeFor + awayAgainst) / 2;
  let la = (awayFor + homeAgainst) / 2;

  // Form adjustment
  const formAdj = (f: string | null | undefined) => {
    if (!f) return 0;
    return f.slice(-5).split("").reduce((a, c) => a + (c === "W" ? 0.025 : c === "L" ? -0.025 : 0), 0);
  };
  lh *= 1 + formAdj(home.form);
  la *= 1 + formAdj(away.form);
  lh = Math.max(0.2, lh);
  la = Math.max(0.2, la);

  const matrix = scoreMatrix(lh, la, 8);
  let pOver15 = 0, pOver25 = 0, pOver35 = 0, pBTTS = 0;
  let pHomeWin = 0, pDraw = 0, pAwayWin = 0;
  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < matrix[i].length; j++) {
      const p = matrix[i][j];
      const tot = i + j;
      if (tot >= 2) pOver15 += p;
      if (tot >= 3) pOver25 += p;
      if (tot >= 4) pOver35 += p;
      if (i >= 1 && j >= 1) pBTTS += p;
      if (i > j) pHomeWin += p;
      else if (i === j) pDraw += p;
      else pAwayWin += p;
    }
  }
  return { lambdaHome: lh, lambdaAway: la, lambdaTotal: lh + la, matrix, pOver15, pOver25, pOver35, pUnder15: 1 - pOver15, pUnder25: 1 - pOver25, pUnder35: 1 - pOver35, pBTTS, pNoBTTS: 1 - pBTTS, pHomeWin, pDraw, pAwayWin, ready: true };
}

async function runBatched<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>, onEach?: () => void): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const my = idx++;
      if (my >= items.length) break;
      try { results[my] = await fn(items[my]); } catch { results[my] = null as unknown as R; }
      onEach?.();
    }
  });
  await Promise.all(workers);
  return results;
}

type PreloadPhase = "idle" | "fixtures" | "stats" | "ready";

export function BetaPanel() {
  const pinned = usePinnedSections();
  const ids = pinned.beta;
  const [open, setOpen] = useState(true);
  const [generated, setGenerated] = useState(false);
  const [phase, setPhase] = useState<PreloadPhase>("idle");
  const [fxLoaded, setFxLoaded] = useState(0);
  const [statsLoaded, setStatsLoaded] = useState(0);
  const [statsTotal, setStatsTotal] = useState(0);
  const [fixtures, setFixtures] = useState<Record<number, ApiFixture | null>>({});
  const [teamStats, setTeamStats] = useState<Record<string, ApiTeamSeasonStats | null>>({});
  // Improvement: adjustable minimum probability threshold
  // Beta = perfil DEFENSIVO. Estratégias: Under 1.5, Under 2.5, Ambas NÃO marcam, Misto
  const [minP, setMinP] = useState(55);
  const [strategy, setStrategy] = useState<"u15" | "u25" | "nobtts" | "mix">("u15");
  const runIdRef = useRef(0);

  const queryClient = useQueryClient();
  const fetchFixture = useServerFn(getFixture);
  const fetchTeamStats = useServerFn(getTeamSeasonStatistics);
  const fetchTeamRecent = useServerFn(getTeamRecentFixtures);
  const fetchFixtureStats = useServerFn(getFixtureStatistics);

  const [corners, setCorners] = useState<Record<number, { home: number; away: number; total: number; sample: number }>>({});
  const [cornersLoading, setCornersLoading] = useState(false);

  const savedQuery = useQuery({
    queryKey: ["fechamentos"],
    queryFn: listFechamentos,
    staleTime: 30_000,
  });
  const saved: Fechamento[] = (savedQuery.data ?? []).filter((f) => f.name.startsWith("Beta"));
  const [viewingSavedId, setViewingSavedId] = useState<string | null>(null);
  const viewingSaved = viewingSavedId ? saved.find((f) => f.id === viewingSavedId) ?? null : null;

  const saveMut = useMutation({
    mutationFn: saveFechamento,
    onSuccess: (row) => {
      queryClient.invalidateQueries({ queryKey: ["fechamentos"] });
      setViewingSavedId(row.id);
    },
  });
  const deleteMut = useMutation({
    mutationFn: deleteFechamento,
    onSuccess: (_d, id) => {
      queryClient.invalidateQueries({ queryKey: ["fechamentos"] });
      if (viewingSavedId === id) setViewingSavedId(null);
    },
  });

  const teamKey = (team: number, league: number, season: number) => `${team}:${league}:${season}`;

  const runPreload = async () => {
    if (ids.length === 0) return;
    const myRun = ++runIdRef.current;
    setPhase("fixtures");
    setFxLoaded(0);
    setStatsLoaded(0);
    setStatsTotal(0);

    const fxResults = await runBatched(ids, 8, async (id) => {
      const data = await queryClient.ensureQueryData({
        queryKey: ["fixture", id],
        queryFn: () => fetchFixture({ data: { id } }),
        staleTime: 60_000,
      });
      return { id, data: data as ApiFixture | null };
    }, () => { if (runIdRef.current === myRun) setFxLoaded((n) => n + 1); });
    if (runIdRef.current !== myRun) return;

    const fxMap: Record<number, ApiFixture | null> = {};
    for (const r of fxResults) if (r) fxMap[r.id] = r.data;
    setFixtures(fxMap);

    const teamJobs = new Map<string, { team: number; league: number; season: number }>();
    for (const fx of Object.values(fxMap)) {
      if (!fx) continue;
      const s = fx.league.season;
      const l = fx.league.id;
      teamJobs.set(teamKey(fx.teams.home.id, l, s), { team: fx.teams.home.id, league: l, season: s });
      teamJobs.set(teamKey(fx.teams.away.id, l, s), { team: fx.teams.away.id, league: l, season: s });
    }
    const jobs = Array.from(teamJobs.entries());
    setStatsTotal(jobs.length);
    setPhase("stats");

    const statsMap: Record<string, ApiTeamSeasonStats | null> = {};
    await runBatched(jobs, 8, async ([key, input]) => {
      let last: ApiTeamSeasonStats | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          last = (await queryClient.ensureQueryData({
            queryKey: ["team-stats", input.team, input.league, input.season],
            queryFn: () => fetchTeamStats({ data: input }),
            staleTime: 6 * 60 * 60_000,
          })) as ApiTeamSeasonStats | null;
          if (last) break;
        } catch { /* retry */ }
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
      statsMap[key] = last;
    }, () => { if (runIdRef.current === myRun) setStatsLoaded((n) => n + 1); });
    if (runIdRef.current !== myRun) return;

    setTeamStats(statsMap);
    setPhase("ready");
  };

  useEffect(() => {
    if (ids.length === 0) { setPhase("idle"); return; }
    runPreload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(",")]);

  const enriched: BetaEnriched[] = useMemo(() => {
    return ids.map((id) => {
      const fx = fixtures[id] ?? null;
      let home: ApiTeamSeasonStats | null = null;
      let away: ApiTeamSeasonStats | null = null;
      if (fx) {
        home = teamStats[teamKey(fx.teams.home.id, fx.league.id, fx.league.season)] ?? null;
        away = teamStats[teamKey(fx.teams.away.id, fx.league.id, fx.league.season)] ?? null;
      }
      return { id, fixture: fx, homeStats: home, awayStats: away, ...computePoisson(fx, home, away) };
    });
  }, [ids, fixtures, teamStats]);

  const missingStats = enriched.filter((e) => !e.ready).length;
  const isPreloading = phase === "fixtures" || phase === "stats";
  const canGenerate = phase === "ready" && ids.length >= 4;

  // Beta strategy: pick 4 defensive games matching selected strategy
  const scoreOf = (e: BetaEnriched) =>
    strategy === "u15" ? e.pUnder15 :
    strategy === "u25" ? e.pUnder25 :
    strategy === "nobtts" ? e.pNoBTTS :
    (e.pUnder15 + e.pNoBTTS) / 2;

  const threshold = minP / 100;
  const eligible = enriched
    .filter((e) => e.ready && scoreOf(e) >= threshold)
    .sort((a, b) => scoreOf(b) - scoreOf(a));
  const selected = generated ? eligible.slice(0, 4) : [];

  // Fetch corners for the 2 top-draw games once selection is generated
  useEffect(() => {
    if (!generated || selected.length < 4) return;
    const drawTop = [...selected].sort((a, b) => b.pDraw - a.pDraw).slice(0, 2);
    let cancelled = false;
    (async () => {
      setCornersLoading(true);
      const fetchTeamCornerAvg = async (teamId: number): Promise<{ avg: number; sample: number }> => {
        try {
          const recent = (await queryClient.ensureQueryData({
            queryKey: ["team-recent", teamId, 5],
            queryFn: () => fetchTeamRecent({ data: { team: teamId, last: 5 } }),
            staleTime: 60 * 60_000,
          })) as ApiFixture[];
          const sample = recent.slice(0, 3);
          let total = 0;
          let n = 0;
          for (const fx of sample) {
            const stats = (await queryClient.ensureQueryData({
              queryKey: ["fixture-stats", fx.fixture.id],
              queryFn: () => fetchFixtureStats({ data: { id: fx.fixture.id } }),
              staleTime: 12 * 60 * 60_000,
            })) as Array<{ team: { id: number }; statistics: { type: string; value: number | string | null }[] }>;
            const teamStats = stats.find((s) => s.team.id === teamId);
            const ck = teamStats?.statistics.find((x) => x.type === "Corner Kicks");
            const v = ck ? num(ck.value, NaN) : NaN;
            if (isFinite(v)) { total += v; n++; }
          }
          return { avg: n > 0 ? total / n : 5, sample: n };
        } catch {
          return { avg: 5, sample: 0 };
        }
      };
      const map: Record<number, { home: number; away: number; total: number; sample: number }> = {};
      for (const e of drawTop) {
        if (!e.fixture) continue;
        const [h, a] = await Promise.all([
          fetchTeamCornerAvg(e.fixture.teams.home.id),
          fetchTeamCornerAvg(e.fixture.teams.away.id),
        ]);
        if (cancelled) return;
        map[e.id] = { home: h.avg, away: a.avg, total: h.avg + a.avg, sample: Math.min(h.sample, a.sample) };
      }
      if (!cancelled) { setCorners(map); setCornersLoading(false); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, selected.map((s) => s.id).join(",")]);

  const poissonCdf = (lambda: number, k: number) => {
    let s = 0;
    for (let i = 0; i <= k; i++) s += poisson(lambda, i);
    return s;
  };

  const tickets = useMemo(() => {
    if (selected.length < 4) return [];
    const conf = (p: number) => Math.round(Math.min(99, p * 100));
    const bestExact = (a: [number, number], b: [number, number]) => {
      let best: BetaEnriched = selected[0];
      let bestP = -1;
      let bestScore = `${a[0]}-${a[1]}`;
      for (const e of selected) {
        const pa = e.matrix[a[0]]?.[a[1]] ?? 0;
        const pb = e.matrix[b[0]]?.[b[1]] ?? 0;
        const p = Math.max(pa, pb);
        if (p > bestP) {
          bestP = p;
          best = e;
          bestScore = pa >= pb ? `${a[0]}-${a[1]}` : `${b[0]}-${b[1]}`;
        }
      }
      return { e: best, p: bestP, score: bestScore };
    };
    const b1 = bestExact([1, 0], [0, 1]);
    const b2 = bestExact([2, 0], [0, 2]);
    const b3 = bestExact([2, 1], [1, 2]);

    const drawSorted = [...selected].sort((x, y) => y.pDraw - x.pDraw);
    const d1 = drawSorted[0];
    const d2 = drawSorted[1] ?? drawSorted[0];
    const cd1 = corners[d1.id];
    const cd2 = corners[d2.id];
    const lambdaC1 = cd1?.total ?? 9.5;
    const lambdaC2 = cd2?.total ?? 9.5;
    const pOver95 = 1 - poissonCdf(lambdaC1, 9);
    const pUnder95 = poissonCdf(lambdaC2, 9);
    const cornerNote = (c: { home: number; away: number; total: number; sample: number } | undefined) =>
      c && c.sample > 0
        ? `escanteios: ${c.home.toFixed(1)}+${c.away.toFixed(1)}=${c.total.toFixed(1)}/jogo`
        : cornersLoading ? "carregando escanteios..." : "escanteios estimados (sem dados)";

    return [
      { n: 1, type: "Placar Exato", label: `Placar exato ${b1.score}`, detail: `${b1.e.fixture?.teams.home.name} × ${b1.e.fixture?.teams.away.name} · λ ${b1.e.lambdaHome.toFixed(2)}–${b1.e.lambdaAway.toFixed(2)}`, conf: conf(b1.p) },
      { n: 2, type: "Placar Exato", label: `Placar exato ${b2.score}`, detail: `${b2.e.fixture?.teams.home.name} × ${b2.e.fixture?.teams.away.name} · λ ${b2.e.lambdaHome.toFixed(2)}–${b2.e.lambdaAway.toFixed(2)}`, conf: conf(b2.p) },
      { n: 3, type: "Placar Exato", label: `Placar exato ${b3.score}`, detail: `${b3.e.fixture?.teams.home.name} × ${b3.e.fixture?.teams.away.name} · λ ${b3.e.lambdaHome.toFixed(2)}–${b3.e.lambdaAway.toFixed(2)}`, conf: conf(b3.p) },
      { n: 4, type: "Aposta Criada", label: "Empate + Over 9.5 escanteios", detail: `${d1.fixture?.teams.home.name} × ${d1.fixture?.teams.away.name} · ${cornerNote(cd1)}`, conf: conf(d1.pDraw * pOver95) },
      { n: 5, type: "Aposta Criada", label: "Empate + Under 9.5 escanteios", detail: `${d2.fixture?.teams.home.name} × ${d2.fixture?.teams.away.name} · ${cornerNote(cd2)}`, conf: conf(d2.pDraw * pUnder95) },
    ];
  }, [selected, corners, cornersLoading]);

  const progressPct = phase === "fixtures"
    ? Math.round((fxLoaded / Math.max(1, ids.length)) * 100)
    : phase === "stats"
      ? Math.round((statsLoaded / Math.max(1, statsTotal)) * 100)
      : phase === "ready" ? 100 : 0;

  // Triagem = fonte de verdade: mostra os selos/notas da Triagem junto aos jogos.
  const triagemViews = useTriagemView((s) => s.byFixture);
  const triagemSelosDe = (id: number) => {
    const view = triagemViews[id];
    if (!view) return null;
    return view.markets.filter(
      (m) => m.passed && m.status === "pending" && m.score >= triagemMinFor(m.market_type),
    );
  };

  return (
    <>
    <div className="mx-3 mb-4">
      <BetaHibridoPanel />
    </div>
    <div className="mx-3 mb-6 rounded-[2.5rem] bg-gradient-to-br from-cyan-500/15 via-card to-card border border-cyan-500/30 overflow-hidden shadow-2xl relative group animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="absolute inset-0 bg-cyan-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
      <div className="flex flex-wrap items-center gap-4 px-5 py-5 relative z-10 border-b border-white/5 bg-cyan-500/5">
        <div className="w-16 h-16 rounded-[1.25rem] bg-cyan-500/20 flex items-center justify-center border border-cyan-500/30 shadow-inner">
          <FlaskConical className="w-8 h-8 text-cyan-400 drop-shadow-[0_0_10px_rgba(34,211,238,0.5)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-base font-black uppercase tracking-wider text-cyan-400">Laboratório IA · Perfil Defensivo</div>
          <div className="text-[12px] text-muted-foreground font-semibold leading-relaxed mt-1">
            Modelagem estatística baseada em {ids.length} jogo(s). Foco absoluto em Under (poucos gols) e Ambas Não Marcam, ideal para fechamentos conservadores de alta precisão.
          </div>
        </div>
        {phase === "ready" && missingStats > 0 && (
          <button onClick={runPreload} title="Retentar" className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground">
            <RotateCw className="w-4 h-4" />
          </button>
        )}
        <button
          onClick={() => { setGenerated(true); setOpen(true); setViewingSavedId(null); }}
          disabled={!canGenerate}
          className="text-xs font-bold px-3 py-1.5 rounded-full bg-cyan-500 text-black disabled:opacity-40 flex items-center gap-1"
        >
          {isPreloading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
          Gerar Fechamento IA
        </button>
        {generated && tickets.length > 0 && !viewingSavedId && (
          <button
            onClick={() => {
              const nextNum = saved.length + 1;
              const targetDate = new Date().toISOString().slice(0, 10);
              const games = selected.map((s) => ({
                id: s.id,
                home: s.fixture?.teams.home.name ?? `Time ${s.id}`,
                away: s.fixture?.teams.away.name ?? "?",
                league: s.fixture?.league.name,
              }));
              saveMut.mutate({
                name: `Beta ${nextNum}`,
                target_date: targetDate,
                games,
                tickets,
                summary: { missingStats, totalGames: ids.length, strategy, minP },
              });
            }}
            disabled={saveMut.isPending}
            title="Salvar este fechamento"
            className="text-xs font-bold px-3 py-1.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 hover:bg-emerald-500/30 disabled:opacity-40 flex items-center gap-1"
          >
            {saveMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            Salvar
          </button>
        )}
        {(generated || viewingSaved) && (
          <button onClick={() => setOpen((v) => !v)} className="w-7 h-7 flex items-center justify-center text-muted-foreground">
            {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        )}
      </div>

      {/* Controls — improvement over Bingão */}
      {ids.length >= 4 && !viewingSaved && (
        <div className="px-3 pb-2 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 text-[10px] font-bold uppercase flex-wrap">
            {(["u15", "u25", "nobtts", "mix"] as const).map((s) => (
              <button
                key={s}
                onClick={() => { setStrategy(s); setGenerated(false); }}
                className={`px-2 py-1 rounded-full border ${strategy === s ? "bg-cyan-500 text-black border-cyan-500" : "bg-black/30 border-white/10 text-muted-foreground"}`}
              >
                {s === "u15" ? "Under 1.5" : s === "u25" ? "Under 2.5" : s === "nobtts" ? "BTTS Não" : "Misto"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground ml-auto">
            Prob. mín. <span className="tabular text-cyan-400 font-bold">{minP}%</span>
            <input
              type="range" min={40} max={85} step={5}
              value={minP}
              onChange={(e) => { setMinP(parseInt(e.target.value)); setGenerated(false); }}
              className="w-24 accent-cyan-400"
            />
          </label>
        </div>
      )}

      {saved.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
          {saved.map((f) => {
            const active = viewingSavedId === f.id;
            return (
              <div key={f.id} className={`group flex items-center gap-1 text-[11px] rounded-full pl-2.5 pr-1 py-1 border ${active ? "bg-cyan-500/25 border-cyan-500 text-cyan-100" : "bg-black/30 border-white/10 text-muted-foreground hover:text-foreground"}`}>
                <button onClick={() => { setViewingSavedId(active ? null : f.id); setOpen(true); }} className="flex items-center gap-1 font-medium">
                  {active && <Check className="w-3 h-3" />}
                  {f.name}
                  <span className="opacity-60 text-[10px]">· {new Date(f.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</span>
                </button>
                <button onClick={() => { if (confirm(`Excluir ${f.name}?`)) deleteMut.mutate(f.id); }} title="Excluir" className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-destructive/30 text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {viewingSaved && open && (
        <div className="px-3 pb-3 space-y-2">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {viewingSaved.name} · {new Date(viewingSaved.created_at).toLocaleString("pt-BR")}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Jogos ({viewingSaved.games.length})</div>
            <div className="space-y-1">
              {viewingSaved.games.map((g) => (
                <div key={g.id} className="text-[11px] bg-black/30 rounded px-2 py-1 truncate">
                  {g.home} × {g.away} <span className="text-muted-foreground">· {g.league ?? ""}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">Bilhetes salvos</div>
            <div className="grid gap-1.5">
              {viewingSaved.tickets.map((t) => (
                <div key={t.n} className="rounded-lg bg-black/30 border border-white/5 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold flex items-center justify-center">B{t.n}</span>
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.type}</span>
                    <span className="ml-auto text-[11px] font-bold text-cyan-400 tabular">Nota {t.conf}%</span>
                  </div>
                  <div className="text-xs font-medium mt-0.5">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{t.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {ids.length < 4 && (
        <div className="px-3 pb-3 text-[11px] text-muted-foreground">
          Importe pelo menos 4 jogos para a pasta Beta usando o atalho 🧪 nos cards.
        </div>
      )}

      {isPreloading && (
        <div className="px-3 pb-3">
          <div className="text-[11px] text-muted-foreground mb-1 flex items-center gap-2">
            <Loader2 className="w-3 h-3 animate-spin" />
            {phase === "fixtures" ? `Carregando dados dos jogos: ${fxLoaded}/${ids.length}` : `Carregando estatísticas dos times: ${statsLoaded}/${statsTotal}`}
          </div>
          <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
            <div className="h-full bg-cyan-400 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        </div>
      )}

      {phase === "ready" && !generated && (
        <div className="px-3 pb-3 text-[11px] text-muted-foreground">
          {missingStats === 0
            ? `✅ Todos os ${ids.length} jogos com estatísticas completas — pronto para analisar.`
            : `⚠️ ${ids.length - missingStats}/${ids.length} jogos com dados. ${missingStats} sem stats (times sem histórico na temporada) — resultado pode ser incompleto.`}
        </div>
      )}

      {generated && open && phase === "ready" && !viewingSaved && (
        <div className="px-3 pb-3 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Diagnóstico ofensivo (Poisson)
            </div>
            <div className="space-y-1">
              {enriched.map((e) => {
                const s = scoreOf(e);
                const isSelected = selected.some((x) => x.id === e.id);
                const triSelos = triagemSelosDe(e.id);
                let statusText: string;
                let statusColor: string;
                if (isSelected) { statusText = "SELECIONADO"; statusColor = "text-cyan-400"; }
                else if (!e.ready) { statusText = "sem stats"; statusColor = "text-destructive"; }
                else if (s < threshold) { statusText = `descartado · ${Math.round(s * 100)}%`; statusColor = "text-amber-500"; }
                else { statusText = `elegível não-top · ${Math.round(s * 100)}%`; statusColor = "text-muted-foreground"; }
                return (
                  <div key={`diag-${e.id}`} className="text-[11px] bg-black/30 rounded-lg px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${isSelected ? "bg-cyan-400" : e.ready ? "bg-amber-500" : "bg-destructive"}`} />
                      <div className="flex-1 min-w-0 truncate font-medium">
                        {e.fixture ? `${e.fixture.teams.home.name} × ${e.fixture.teams.away.name}` : `Fixture ${e.id}`}
                      </div>
                      {triSelos && triSelos.length > 0 && (
                        <div className="flex items-center gap-1">
                          {triSelos.slice(0, 3).map((s2) => (
                            <span
                              key={s2.market_type}
                              title={`Triagem · ${s2.label} · ★${s2.score}`}
                              className="px-1 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-black"
                            >
                              ✓ {TRIAGEM_TAG[s2.market_type] ?? s2.market_type} ★{s2.score}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className={`text-[10px] font-bold ${statusColor}`}>{statusText}</span>
                    </div>
                    {e.ready && (
                      <div className="grid grid-cols-4 gap-1 mt-1 text-[10px] text-muted-foreground tabular">
                        <div>U1.5 <span className="text-foreground">{Math.round(e.pUnder15 * 100)}%</span></div>
                        <div>U2.5 <span className="text-foreground">{Math.round(e.pUnder25 * 100)}%</span></div>
                        <div>U3.5 <span className="text-foreground">{Math.round(e.pUnder35 * 100)}%</span></div>
                        <div>BTTS Não <span className="text-foreground">{Math.round(e.pNoBTTS * 100)}%</span></div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
              Jogos elegíveis ({selected.length}/4) · {strategy === "u15" ? "P(Under 1.5)" : strategy === "u25" ? "P(Under 2.5)" : strategy === "nobtts" ? "P(BTTS Não)" : "Score Misto"} ≥ {minP}%
            </div>
            {selected.length < 4 && (
              <div className="text-xs text-destructive mb-1">
                Poucos jogos atendem ao critério. Reduza a Prob. mínima ou adicione confrontos mais defensivos.
              </div>
            )}
            <div className="space-y-1">
              {selected.map((e, idx) => {
                const triSelos = triagemSelosDe(e.id);
                return (
                  <div key={e.id} className="flex items-center gap-2 text-xs bg-black/30 rounded-lg px-2 py-1.5">
                    <span className="w-5 h-5 rounded-full bg-cyan-500/20 text-cyan-400 text-[10px] font-bold flex items-center justify-center">J{idx + 1}</span>
                    <div className="flex-1 min-w-0 truncate">
                      {e.fixture ? `${e.fixture.teams.home.name} × ${e.fixture.teams.away.name}` : `Fixture ${e.id}`}
                    </div>
                    {triSelos && triSelos.length > 0 && (
                      <div className="flex items-center gap-1">
                        {triSelos.slice(0, 2).map((s) => (
                          <span
                            key={s.market_type}
                            title={`Triagem · ${s.label} · ★${s.score}`}
                            className="px-1 rounded bg-emerald-500/20 text-emerald-300 text-[9px] font-black"
                          >
                            ✓ {TRIAGEM_TAG[s.market_type] ?? s.market_type} ★{s.score}
                          </span>
                        ))}
                      </div>
                    )}
                    <span className="text-muted-foreground tabular text-[10px]">λ {e.lambdaTotal.toFixed(2)}</span>
                    <span className="text-cyan-400 font-bold tabular">{Math.round(scoreOf(e) * 100)}%</span>
                  </div>
                );
              })}
            </div>
          </div>

          {tickets.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">Bilhetes gerados (Beta · Defensivo)</div>
              <div className="grid gap-1.5">
                {tickets.map((t) => (
                  <div key={t.n} className="rounded-lg bg-black/30 border border-white/5 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded bg-cyan-500/20 text-cyan-300 text-[10px] font-bold flex items-center justify-center">B{t.n}</span>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t.type}</span>
                      <span className="ml-auto text-[11px] font-bold text-cyan-400 tabular">Nota {t.conf}%</span>
                    </div>
                    <div className="text-xs font-medium mt-0.5">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{t.detail}</div>
                  </div>
                ))}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
                * B1–B3: placares exatos via Poisson (menor gols marginal). B4–B5: empate combinado com escanteios (média das últimas 3 partidas de cada time). Sempre confirme antes de apostar.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
