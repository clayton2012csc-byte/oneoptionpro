import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { X, Bell, BellOff, Maximize2, Star, RefreshCw } from "lucide-react";
import { useFavorites, toggleFavorite, FavoriteButton, NotificationButton } from "@/lib/favorites";
import { isSoundEnabled, setSoundEnabled, primeSound, playAlert } from "@/lib/alert-sound";
import { toast } from "sonner";
import { BackHeader } from "@/components/BackHeader";
import {
  getFixture, getFixtureEvents, getFixtureStatistics, getFixtureLineups, getH2H, getStandings,
  getOdds, getMatchPreview,
  LIVE_STATUSES, FINISHED_STATUSES,
  type ApiFixture, type ApiEvent, type ApiTeamStats, type ApiLineup, type ApiStandingsResp,
  type ApiOddsResp, type TeamPreviewStats,
} from "@/lib/api-football.functions";
import { computeOwnPrediction, pctFmt } from "@/lib/own-prediction";
import { buildMasterPrediction } from "@/lib/master-engine";
import { setSelectedFixture } from "@/lib/selected-fixture";
import { toggleFixture, usePinnedSections, type SectionId } from "@/lib/pinned-sections";

const PIN_SECTIONS: { id: SectionId; icon: string; label: string }[] = [
  { id: "bingao", icon: "🎯", label: "Bingão" },
  { id: "beta", icon: "🧪", label: "Beta" },
  { id: "alfha", icon: "⚡", label: "Alfha" },
];

type Tab = "detalhes" | "escalacoes" | "previsao" | "stats" | "tabela" | "cd" | "dados" | "odds";

const TABS: [Tab, string][] = [
  ["detalhes", "Detalhes"],
  ["escalacoes", "Escalações"],
  ["previsao", "Previsão IA"],
  ["stats", "Estatísticas"],
  ["tabela", "Classificações"],
  ["cd", "CD"],
  ["dados", "Dados"],
  ["odds", "Probabilidades"],
];

export function MatchDetailPanel({ fixtureId, embedded = false }: { fixtureId: number; embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("detalhes");
  const fetchFixture = useServerFn(getFixture);
  const fxQ = useQuery({
    queryKey: ["fixture", fixtureId],
    queryFn: () => fetchFixture({ data: { id: fixtureId } }),
    refetchInterval: (q) => {
      const f = q.state.data as ApiFixture | null | undefined;
      return f && LIVE_STATUSES.has(f.fixture.status.short) ? 90_000 : false;
    },
  });

  if (fxQ.isLoading) return <div className="p-4 text-sm text-muted-foreground">Carregando...</div>;
  const f = fxQ.data;
  if (!f) return (
    <div className="p-12 flex flex-col items-center justify-center gap-8 text-center bg-card rounded-[2.5rem] border border-white/5 shadow-2xl mx-4 my-8 relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-destructive/5 to-transparent pointer-events-none" />
      <div className="w-24 h-24 rounded-[2rem] bg-destructive/10 border border-destructive/20 flex items-center justify-center relative z-10 animate-pulse">
        <X className="w-12 h-12 text-destructive/60" />
      </div>
      <div className="space-y-3 relative z-10">
        <h3 className="text-xl font-black uppercase tracking-tighter">Partida não encontrada</h3>
        <p className="text-[13px] text-muted-foreground font-medium max-w-[280px] mx-auto leading-relaxed">
          Os dados deste confronto ainda não foram sincronizados ou o evento foi removido da grade oficial.
        </p>
      </div>
      <div className="flex gap-3 relative z-10">
        {embedded && (
          <button 
            onClick={() => setSelectedFixture(null)}
            className="px-6 py-3 rounded-xl bg-white/5 border border-white/10 text-[11px] font-black uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95"
          >
            Voltar
          </button>
        )}
        <button 
          onClick={() => fxQ.refetch()}
          className="px-6 py-3 rounded-xl bg-primary text-primary-foreground text-[11px] font-black uppercase tracking-widest hover:bg-primary/90 transition-all active:scale-95 flex items-center gap-2 shadow-[0_0_30px_rgba(var(--primary),0.3)]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Tentar Novamente
        </button>
      </div>
    </div>
  );

  const isLive = LIVE_STATUSES.has(f.fixture.status.short);
  const isFinished = FINISHED_STATUSES.has(f.fixture.status.short);
  const statusText = isLive
    ? f.fixture.status.short === "HT" ? "INTERVALO" : `${f.fixture.status.elapsed ?? 0}'`
    : isFinished ? "Fim de jogo"
    : new Date(f.fixture.date).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-2xl bg-card border border-white/5 overflow-hidden">
      <div className="header-glow relative px-3 pt-3 pb-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {!embedded ? (
              <BackHeader title="" />
            ) : (
              <div className="flex items-center gap-1.5 min-w-0">
                <img src={f.league.logo} alt="" className="w-4 h-4 object-contain" />
                <span className="text-[11px] font-semibold truncate">{f.league.name}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => window.location.reload()}
              className="w-7 h-7 rounded-full bg-black/40 border border-white/5 flex items-center justify-center hover:bg-black/60 transition-colors"
              aria-label="Recarregar dados"
              title="Recarregar"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {embedded && (
              <Link
                to="/jogo/$fixtureId"
                params={{ fixtureId: String(fixtureId) }}
                className="w-7 h-7 rounded-full bg-black/40 border border-white/5 flex items-center justify-center hover:bg-black/60 transition-colors"
                aria-label="Abrir em tela cheia"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Link>
            )}
            <FavoriteButton fixtureId={fixtureId} />
            <NotificationButton fixtureId={fixtureId} />
            {embedded && (
              <button
                onClick={() => setSelectedFixture(null)}
                className="w-7 h-7 rounded-full bg-black/40 border border-white/5 flex items-center justify-center hover:bg-black/60 transition-colors"
                aria-label="Fechar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <img src={f.teams.home.logo} alt="" className="w-12 h-12 object-contain" />
            <span className="text-xs font-semibold text-center truncate w-full">{f.teams.home.name}</span>
          </div>
          <div className="flex flex-col items-center gap-0.5 px-2">
            <div className="tabular text-2xl font-display font-bold">
              {f.goals.home ?? "-"} <span className="text-muted-foreground">:</span> {f.goals.away ?? "-"}
            </div>
            <span className={`text-[10px] font-bold ${isLive ? "text-primary" : "text-muted-foreground"}`}>{statusText}</span>
          </div>
          <div className="flex flex-col items-center gap-1 min-w-0">
            <img src={f.teams.away.logo} alt="" className="w-12 h-12 object-contain" />
            <span className="text-xs font-semibold text-center truncate w-full">{f.teams.away.name}</span>
          </div>
        </div>

        <PinShortcuts fixtureId={fixtureId} />
      </div>


      <div className="border-b border-border/50 px-1 overflow-x-auto scrollbar-none">
        <div className="flex gap-0.5 min-w-max">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 px-2.5 py-2 text-[11px] font-semibold border-b-2 ${
                tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`p-3 overflow-y-auto ${embedded ? 'max-h-[70vh]' : ''}`}>
        {tab === "detalhes" && <ResumoTab fixtureId={fixtureId} home={f.teams.home.id} isLive={isLive} fixture={f} />}
        {tab === "escalacoes" && <LineupsTab fixtureId={fixtureId} />}
        {tab === "previsao" && <PredictionsTab fixture={f} />}
        {tab === "stats" && <StatsTab fixtureId={fixtureId} home={f.teams.home} away={f.teams.away} isLive={isLive} />}
        {tab === "tabela" && <StandingsTab league={f.league.id} season={f.league.season} highlight={[f.teams.home.id, f.teams.away.id]} />}
        {tab === "cd" && <H2HTab home={f.teams.home.id} away={f.teams.away.id} />}
        {tab === "dados" && <DadosTab fixture={f} />}
        {tab === "odds" && <OddsTab fixtureId={fixtureId} />}
      </div>
    </div>
  );
}

function eventIcon(e: ApiEvent) {
  if (e.type === "Goal") return "⚽";
  if (e.type === "Card") return e.detail.includes("Red") ? "🟥" : "🟨";
  if (e.type === "subst") return "🔁";
  if (e.type === "Var") return "📺";
  return "•";
}

function usePreview(fx: ApiFixture, enabled: boolean) {
  const fn = useServerFn(getMatchPreview);
  return useQuery({
    queryKey: ["preview", fx.teams.home.id, fx.teams.away.id],
    queryFn: () => fn({ data: { homeId: fx.teams.home.id, awayId: fx.teams.away.id, last: 5 } }),
    staleTime: 30 * 60_000,
    enabled,
  });
}

function ResumoTab({ fixtureId, home, isLive, fixture }: { fixtureId: number; home: number; isLive: boolean; fixture: ApiFixture }) {
  const isFinished = FINISHED_STATUSES.has(fixture.fixture.status.short);
  const isUpcoming = !isLive && !isFinished;

  const fn = useServerFn(getFixtureEvents);
  const q = useQuery({
    queryKey: ["events", fixtureId],
    queryFn: () => fn({ data: { id: fixtureId } }),
    refetchInterval: isLive ? 20_000 : false,
    enabled: !isUpcoming,
  });

  if (isUpcoming) return <PreviewBlock fixture={fixture} />;
  if (q.isLoading) return <Skeleton />;
  if (!q.data || q.data.length === 0) return <Empty>Sem eventos ainda.</Empty>;
  return (
    <ul className="space-y-2">
      {q.data.map((e, i) => {
        const isHome = e.team.id === home;
        return (
          <li key={i} className={`flex items-center gap-2 rounded-xl bg-black/30 px-3 py-2 ${isHome ? "" : "flex-row-reverse text-right"}`}>
            <span className="text-xs tabular w-8 text-muted-foreground shrink-0">{e.time.elapsed}'{e.time.extra ? `+${e.time.extra}` : ""}</span>
            <span className="text-lg shrink-0">{eventIcon(e)}</span>
            <div className="min-w-0 flex-1">
              <div className="text-xs truncate">{e.player.name ?? "—"}</div>
              <div className="text-[10px] text-muted-foreground truncate">{e.detail}{e.assist.name ? ` · ${e.assist.name}` : ""}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function statRow(label: string, h: string | number, a: string | number, hint?: string) {
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-2 py-1 items-center">
      <span className="text-xs font-semibold tabular">{h}</span>
      <span className="text-[10px] text-muted-foreground text-center">
        {label}
        {hint && <span className="block text-[9px] opacity-60">{hint}</span>}
      </span>
      <span className="text-xs font-semibold tabular text-right">{a}</span>
    </div>
  );
}

function PreviewBlock({ fixture }: { fixture: ApiFixture }) {
  const q = usePreview(fixture, true);
  if (q.isLoading) return <Skeleton />;
  if (!q.data || (q.data.home.played === 0 && q.data.away.played === 0)) {
    return <Empty>Sem histórico recente das duas equipes.</Empty>;
  }
  const { home, away, last } = q.data;
  const pred = computeOwnPrediction(home, away);
  const master = buildMasterPrediction(pred);
  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-black/30 p-3">
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">
          Últimos {last} jogos · lado a lado
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <img src={fixture.teams.home.logo} alt="" className="w-4 h-4 object-contain shrink-0" />
            <span className="text-[11px] font-semibold truncate">{fixture.teams.home.name}</span>
          </div>
          <span className="text-[9px] text-muted-foreground">vs</span>
          <div className="flex items-center gap-1.5 min-w-0 justify-end">
            <span className="text-[11px] font-semibold truncate text-right">{fixture.teams.away.name}</span>
            <img src={fixture.teams.away.logo} alt="" className="w-4 h-4 object-contain shrink-0" />
          </div>
        </div>
        <div className="divide-y divide-border/40">
          {statRow("Jogos", home.played, away.played)}
          {statRow("Forma", home.form || "—", away.form || "—", "recente → antigo")}
          {statRow("Gols / jogo", home.goalsForAvg, away.goalsForAvg)}
          {statRow("Sofr. / jogo", home.goalsAgainstAvg, away.goalsAgainstAvg)}
          {statRow("Escant. favor", home.cornersForAvg, away.cornersForAvg)}
          {statRow("Escant. contra", home.cornersAgainstAvg, away.cornersAgainstAvg)}
          {statRow("Total escant.", home.cornersTotalAvg, away.cornersTotalAvg)}
          {statRow("Chutes no gol", home.shotsOnGoalAvg, away.shotsOnGoalAvg)}
          {statRow("Cartões", home.cardsAvg, away.cardsAvg)}
          {statRow("BTTS", `${home.bttsPct}%`, `${away.bttsPct}%`)}
          {statRow("Over 2.5", `${home.over25Pct}%`, `${away.over25Pct}%`)}
          {statRow("Clean sheet", `${home.cleanSheetPct}%`, `${away.cleanSheetPct}%`)}
          {statRow("Não marcou", `${home.failedToScorePct}%`, `${away.failedToScorePct}%`)}
        </div>
      </div>

      {pred.ready && (
        <div className="rounded-xl bg-primary/10 border border-primary/30 p-3">
          <div className="text-[10px] font-bold uppercase text-primary mb-2 flex items-center justify-between">
            <span>Nossa previsão (Poisson · λ {pred.lambdaHome} vs {pred.lambdaAway})</span>
            <span className="text-[9px] opacity-70">Confiança IA</span>
          </div>
          <div className="grid grid-cols-3 gap-1.5 mb-3">
            <MiniStat label="Casa" value={pctFmt(pred.pHome)} />
            <MiniStat label="Empate" value={pctFmt(pred.pDraw)} />
            <MiniStat label="Fora" value={pctFmt(pred.pAway)} />
            <MiniStat label="Over 2.5" value={pctFmt(pred.pOver25)} />
            <MiniStat label="BTTS" value={pctFmt(pred.pBTTS)} />
            <MiniStat label="Escant. > 9.5" value={pctFmt(pred.pCornersOver95)} />
          </div>
          
          <div className="mt-2 p-2 rounded-lg bg-black/40 border border-white/5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[11px] font-bold text-foreground">Palpite Estratégico OneOption</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              {pred.expectedGoals > 2.8 ? (
                `IA detecta jogo com tendência de OVER (${pred.expectedGoals.toFixed(2)} gols exp.). Placar sugerido: ${master.exactScore.label || '2-1'}. Tendência 1X2: ${master.trend.label}.`
              ) : pred.expectedGoals < 1.9 ? (
                `IA detecta jogo com forte tendência de UNDER (${pred.expectedGoals.toFixed(2)} gols exp.). Placar sugerido: ${master.exactScore.label || '1-0'}. Tendência 1X2: ${master.trend.label}.`
              ) : (
                `IA detecta jogo EQUILIBRADO (${pred.expectedGoals.toFixed(2)} gols exp.). Placar sugerido: ${master.exactScore.label || '1-1'}. Tendência 1X2: ${master.trend.label}.`
              )}
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {([["h", home, fixture.teams.home], ["a", away, fixture.teams.away]] as const).map(([k, s, team]) => (
          <div key={k} className="rounded-xl bg-black/30 p-2.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <img src={team.logo} alt="" className="w-4 h-4 object-contain" />
              <span className="text-[11px] font-semibold truncate">{team.name}</span>
            </div>
            <ul className="space-y-0.5">
              {s.lastResults.map((r, i) => (
                <li key={i} className="flex items-center gap-1 text-[10px]">
                  <span className={`w-3 text-center font-bold ${r.result === "V" ? "text-emerald-400" : r.result === "D" ? "text-destructive" : "text-amber-400"}`}>{r.result}</span>
                  <span className="text-muted-foreground">{r.home ? "vs" : "@"}</span>
                  <span className="truncate flex-1">{r.opp}</span>
                  <span className="tabular font-semibold">{r.gf}–{r.ga}</span>
                </li>
              ))}
              {s.lastResults.length === 0 && <li className="text-[10px] text-muted-foreground">Sem jogos.</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-black/40 border border-white/5 p-2 text-center">
      <div className="text-sm font-bold tabular text-primary">{value}</div>
      <div className="text-[9px] text-muted-foreground truncate">{label}</div>
    </div>
  );
}


function pct(v: number | string | null) {
  if (v == null) return 0;
  if (typeof v === "string" && v.endsWith("%")) return Number(v.slice(0, -1));
  return Number(v) || 0;
}
const STAT_LABELS: Record<string, string> = {
  "Ball Possession": "Posse de bola",
  "Total Shots": "Total de chutes",
  "Shots on Goal": "Chutes no alvo",
  "Shots off Goal": "Chutes pra fora",
  "Shots insidebox": "Chutes na área",
  "Shots outsidebox": "Chutes de fora",
  "Blocked Shots": "Chutes bloqueados",
  "Corner Kicks": "Escanteios",
  "Offsides": "Impedimentos",
  "Fouls": "Faltas",
  "Yellow Cards": "Cartões amarelos",
  "Red Cards": "Cartões vermelhos",
  "Goalkeeper Saves": "Defesas do goleiro",
  "Total passes": "Passes totais",
  "Passes accurate": "Passes certos",
  "Passes %": "Precisão de passes",
  "expected_goals": "Gols esperados (xG)",
};

function StatsTab({ fixtureId, isLive }: { fixtureId: number; home: { name: string }; away: { name: string }; isLive: boolean }) {
  const fn = useServerFn(getFixtureStatistics);
  const q = useQuery({
    queryKey: ["stats", fixtureId],
    queryFn: () => fn({ data: { id: fixtureId } }),
    refetchInterval: isLive ? 20_000 : false,
  });
  if (q.isLoading) return <Skeleton />;
  if (!q.data || q.data.length < 2) return <Empty>Estatísticas indisponíveis.</Empty>;
  const [h, a] = q.data as ApiTeamStats[];
  const types = h.statistics.map((s) => s.type);
  return (
    <div className="space-y-3">
      {types.map((t, i) => {
        const hv = h.statistics[i]?.value ?? 0;
        const av = a.statistics.find((s) => s.type === t)?.value ?? 0;
        const hn = pct(hv), an = pct(av);
        const total = hn + an;
        const hp = total > 0 ? (hn / total) * 100 : 50;
        return (
          <div key={t}>
            <div className="flex items-center justify-between text-[11px] mb-1 tabular">
              <span className="font-bold w-10">{hv ?? 0}</span>
              <span className="text-muted-foreground text-center flex-1">{STAT_LABELS[t] ?? t}</span>
              <span className="font-bold w-10 text-right">{av ?? 0}</span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
              <div style={{ width: `${hp}%` }} className="bg-primary" />
              <div style={{ width: `${100 - hp}%` }} className="bg-destructive/70" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LineupsTab({ fixtureId }: { fixtureId: number }) {
  const fn = useServerFn(getFixtureLineups);
  const q = useQuery({ queryKey: ["lineups", fixtureId], queryFn: async () => (await fn({ data: { id: fixtureId } })) as ApiLineup[], staleTime: 60 * 60_000 });
  if (q.isLoading) return <Skeleton />;
  if (!q.data || q.data.length === 0) return <Empty>Escalações não confirmadas.</Empty>;
  return (
    <div className="space-y-3">
      {(q.data as ApiLineup[]).map((l) => (
        <div key={l.team.id} className="rounded-xl bg-black/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <img src={l.team.logo} alt="" className="w-5 h-5 object-contain" />
            <div className="min-w-0">
              <div className="text-xs font-bold truncate">{l.team.name}</div>
              <div className="text-[10px] text-muted-foreground">{l.formation}</div>
            </div>
          </div>
          <ul className="space-y-0.5">
            {l.startXI.map((p) => (
              <li key={p.player.id} className="flex items-center gap-2 text-[11px]">
                <span className="w-5 text-center tabular text-primary">{p.player.number}</span>
                <span className="truncate flex-1">{p.player.name}</span>
                <span className="text-muted-foreground text-[10px]">{p.player.pos}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function H2HTab({ home, away }: { home: number; away: number }) {
  const fn = useServerFn(getH2H);
  const q = useQuery({
    queryKey: ["h2h", home, away],
    queryFn: () => fn({ data: { h2h: `${home}-${away}`, last: 10 } }),
    staleTime: 60 * 60_000,
  });
  if (q.isLoading) return <Skeleton />;
  if (!q.data || q.data.length === 0) return <Empty>Sem confrontos.</Empty>;
  return (
    <ul className="space-y-1.5">
      {(q.data as ApiFixture[]).map((m) => (
        <div key={m.fixture.id} className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl bg-black/30 px-2 py-1.5">
          <span className="text-[10px] text-muted-foreground tabular w-12">{new Date(m.fixture.date).toLocaleDateString("pt-BR")}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] min-w-0">
              <img src={m.teams.home.logo} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
              <span className="truncate">{m.teams.home.name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] min-w-0">
              <img src={m.teams.away.logo} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
              <span className="truncate">{m.teams.away.name}</span>
            </div>
          </div>
          <div className="tabular text-[11px] font-bold text-center">
            <div>{m.goals.home ?? "-"}</div>
            <div>{m.goals.away ?? "-"}</div>
          </div>
        </div>
      ))}
    </ul>
  );
}

function StandingsTab({ league, season, highlight }: { league: number; season: number; highlight: number[] }) {
  const fn = useServerFn(getStandings);
  const q = useQuery({
    queryKey: ["standings", league, season],
    queryFn: () => fn({ data: { league, season } }),
    staleTime: 60 * 60_000,
  });
  if (q.isLoading) return <Skeleton />;
  const table = (q.data as ApiStandingsResp[] | undefined)?.[0]?.league.standings?.[0];
  if (!table || table.length === 0) return <Empty>Classificação indisponível.</Empty>;
  return (
    <div className="rounded-xl bg-black/30 overflow-hidden">
      <div className="grid grid-cols-[20px_1fr_24px_24px_28px_28px] gap-1 px-2 py-1.5 text-[9px] uppercase text-muted-foreground font-bold border-b border-border/50">
        <span>#</span><span>Time</span><span className="text-center">M</span><span className="text-center">GD</span><span className="text-center">SG</span><span className="text-center">Pts</span>
      </div>
      {table.map((row) => {
        const hi = highlight.includes(row.team.id);
        return (
          <div key={row.team.id} className={`grid grid-cols-[20px_1fr_24px_24px_28px_28px] gap-1 px-2 py-1.5 text-[11px] tabular items-center ${hi ? "bg-primary/10" : ""}`}>
            <span className="text-muted-foreground">{row.rank}</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <img src={row.team.logo} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
              <span className="truncate">{row.team.name}</span>
            </div>
            <span className="text-center">{row.all.played}</span>
            <span className="text-center">{row.all.goals.for - row.all.goals.against}</span>
            <span className="text-center text-muted-foreground">{row.goalsDiff}</span>
            <span className="text-center font-bold">{row.points}</span>
          </div>
        );
      })}
    </div>
  );
}

function PredictionsTab({ fixture }: { fixture: ApiFixture }) {
  const q = usePreview(fixture, true);
  if (q.isLoading) return <Skeleton />;
  if (!q.data || (q.data.home.played === 0 && q.data.away.played === 0)) {
    return <Empty>Sem dados suficientes das duas equipes para prever.</Empty>;
  }
  const pred = computeOwnPrediction(q.data.home, q.data.away);
  if (!pred.ready) return <Empty>Sem dados suficientes das duas equipes para prever.</Empty>;
  const master = buildMasterPrediction(pred);

  const advice =
    master.trend.winner === "home" ? `Favorito claro: ${fixture.teams.home.name}` :
    master.trend.winner === "away" ? `Favorito claro: ${fixture.teams.away.name}` :
    "Jogo equilibrado — empate provável";

  return (
    <div className="space-y-3">
      <div className="rounded-xl bg-primary/10 border border-primary/30 p-3">
        <div className="text-[10px] font-bold uppercase text-primary mb-1">Nossa IA (Poisson · últimos 5)</div>
        <div className="text-xs">{advice}</div>
        <div className="text-[10px] text-muted-foreground mt-1">
          λ Casa {pred.lambdaHome} · λ Fora {pred.lambdaAway} · Gols esperados {pred.expectedGoals}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Resultado 1X2</div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Casa" value={pctFmt(pred.pHome)} />
          <MiniStat label="Empate" value={pctFmt(pred.pDraw)} />
          <MiniStat label="Fora" value={pctFmt(pred.pAway)} />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Gols</div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Over 1.5" value={pctFmt(pred.pOver15)} />
          <MiniStat label="Over 2.5" value={pctFmt(pred.pOver25)} />
          <MiniStat label="Over 3.5" value={pctFmt(pred.pOver35)} />
          <MiniStat label="Under 1.5" value={pctFmt(pred.pUnder15)} />
          <MiniStat label="Under 2.5" value={pctFmt(pred.pUnder25)} />
          <MiniStat label="BTTS" value={pctFmt(pred.pBTTS)} />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">
          Escanteios · média projetada {pred.expectedCorners}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Over 8.5" value={pctFmt(pred.pCornersOver85)} />
          <MiniStat label="Over 9.5" value={pctFmt(pred.pCornersOver95)} />
          <MiniStat label="Over 10.5" value={pctFmt(pred.pCornersOver105)} />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Ambas marcam + resultado</div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="BTTS + Over 2.5" value={pctFmt(pred.pBttsAndOver25)} />
          <MiniStat label="BTTS + Casa" value={pctFmt(pred.pBttsAndHome)} />
          <MiniStat label="BTTS + Empate" value={pctFmt(pred.pBttsAndDraw)} />
          <MiniStat label="BTTS + Fora" value={pctFmt(pred.pBttsAndAway)} />
        </div>
      </div>

      {pred.bttsTopScores.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Ambas marcam · placar provável</div>
          <div className="grid grid-cols-4 gap-1.5">
            {pred.bttsTopScores.map((s) => (
              <div key={s.label} className="rounded-lg bg-emerald-500/10 border border-emerald-500/30 p-1.5 text-center">
                <div className="text-sm font-bold tabular">{s.label}</div>
                <div className="text-[10px] text-emerald-300 tabular">{pctFmt(s.p)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">1º tempo · Resultado</div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Casa 1T" value={pctFmt(pred.htHome)} />
          <MiniStat label="Empate 1T" value={pctFmt(pred.htDraw)} />
          <MiniStat label="Fora 1T" value={pctFmt(pred.htAway)} />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">2º tempo · Resultado</div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Casa 2T" value={pctFmt(pred.shHome)} />
          <MiniStat label="Empate 2T" value={pctFmt(pred.shDraw)} />
          <MiniStat label="Fora 2T" value={pctFmt(pred.shAway)} />
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">HT/FT · combinações mais prováveis (coerentes com a tendência)</div>
        <div className="grid grid-cols-4 gap-1.5">
          {master.htFt.list.map((s) => (
            <div key={s.label} className={`rounded-lg border p-1.5 text-center ${s.label === master.htFt.primary ? "bg-primary/25 border-primary/60" : "bg-primary/10 border-primary/30"}`}>
              <div className={`text-sm font-bold tabular ${s.label === master.htFt.primary ? "text-primary" : ""}`}>{s.label}</div>
              <div className="text-[10px] text-primary tabular">{pctFmt(s.p)}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Placares mais prováveis (filtrados pela tendência 1X2)</div>
        <div className="grid grid-cols-5 gap-1.5">
          {master.exactScores.map((s) => (
            <div key={s.label} className={`rounded-lg border p-1.5 text-center ${s.label === master.exactScore.label ? "bg-primary/25 border-primary/60" : "bg-black/40 border-white/5"}`}>
              <div className={`text-sm font-bold tabular ${s.label === master.exactScore.label ? "text-primary" : ""}`}>{s.label}</div>
              <div className="text-[10px] text-primary tabular">{pctFmt(s.p)}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

function DadosTab({ fixture }: { fixture: ApiFixture }) {
  const q = usePreview(fixture, true);
  if (q.isLoading) return <Skeleton />;
  if (!q.data || (q.data.home.played === 0 && q.data.away.played === 0)) {
    return <Empty>Sem dados dos últimos jogos.</Empty>;
  }
  const { home, away } = q.data;
  const rows: [string, number, number][] = [
    ["Gols marcados / jogo", home.goalsForAvg, away.goalsForAvg],
    ["Gols sofridos / jogo", home.goalsAgainstAvg, away.goalsAgainstAvg],
    ["Escant. favor / jogo", home.cornersForAvg, away.cornersForAvg],
    ["Escant. contra / jogo", home.cornersAgainstAvg, away.cornersAgainstAvg],
    ["Chutes no gol / jogo", home.shotsOnGoalAvg, away.shotsOnGoalAvg],
    ["Cartões / jogo", home.cardsAvg, away.cardsAvg],
    ["BTTS %", home.bttsPct, away.bttsPct],
    ["Over 2.5 %", home.over25Pct, away.over25Pct],
    ["Clean sheet %", home.cleanSheetPct, away.cleanSheetPct],
    ["Não marcou %", home.failedToScorePct, away.failedToScorePct],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([k, h, a]) => {
        const total = h + a || 1;
        const hp = (h / total) * 100;
        return (
          <div key={k}>
            <div className="flex justify-between text-[11px] mb-1 tabular">
              <span className="font-bold w-14">{h}</span>
              <span className="text-muted-foreground uppercase text-[10px] text-center flex-1">{k}</span>
              <span className="font-bold w-14 text-right">{a}</span>
            </div>
            <div className="flex h-1 rounded-full overflow-hidden bg-muted">
              <div style={{ width: `${hp}%` }} className="bg-primary" />
              <div style={{ width: `${100 - hp}%` }} className="bg-destructive/70" />
            </div>
          </div>
        );
      })}
    </div>
  );
}


function OddsTab({ fixtureId }: { fixtureId: number }) {
  const fn = useServerFn(getOdds);
  const q = useQuery({ queryKey: ["odds", fixtureId], queryFn: () => fn({ data: { id: fixtureId } }), staleTime: 5 * 60_000 });
  if (q.isLoading) return <Skeleton />;
  const bookmaker = (q.data as ApiOddsResp[] | undefined)?.[0]?.bookmakers?.[0];
  if (!bookmaker) return <Empty>Sem probabilidades disponíveis.</Empty>;
  return (
    <div className="space-y-3">
      <div className="text-[10px] uppercase text-muted-foreground">{bookmaker.name}</div>
      {bookmaker.bets.slice(0, 6).map((b) => (
        <div key={b.id}>
          <div className="text-[11px] font-bold mb-1.5">{b.name}</div>
          <div className="flex flex-wrap gap-1.5">
            {b.values.slice(0, 6).map((v) => (
              <div key={v.value} className="flex-1 min-w-[70px] rounded-lg bg-black/30 border border-white/5 px-2 py-1.5 text-center">
                <div className="text-[10px] text-muted-foreground truncate">{v.value}</div>
                <div className="text-sm font-bold text-primary tabular">{v.odd}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Skeleton() {
  return <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-10 rounded-xl bg-black/30 animate-pulse" />)}</div>;
}
function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted-foreground py-8 text-center">{children}</p>;
}

function PinShortcuts({ fixtureId }: { fixtureId: number }) {
  const pinned = usePinnedSections();
  return (
    <div className="mt-3 flex items-center justify-center gap-2">
      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">Importar para:</span>
      {PIN_SECTIONS.map((s) => {
        const active = pinned[s.id].includes(fixtureId);
        return (
          <button
            key={s.id}
            onClick={() => toggleFixture(s.id, fixtureId)}
            title={active ? `Remover de ${s.label}` : `Importar para ${s.label}`}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 border text-[11px] font-semibold transition ${
              active
                ? "bg-primary/20 border-primary/60 text-primary"
                : "bg-black/40 border-white/10 text-muted-foreground hover:border-primary/40 hover:text-foreground"
            }`}
          >
            <span className="text-sm leading-none">{s.icon}</span>
            <span>{s.label}</span>
            {active && <span className="text-[9px]">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
