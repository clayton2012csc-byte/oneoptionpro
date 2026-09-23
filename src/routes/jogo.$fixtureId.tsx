import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { MapPin, User, Sparkles, Star, RefreshCw, ArrowLeft } from "lucide-react";
import { BackHeader } from "@/components/BackHeader";
import {
  getFixture, getFixtureEvents, getFixtureStatistics, getFixtureLineups, getH2H, getStandings, getMatchPreview,
  LIVE_STATUSES, FINISHED_STATUSES,
  type ApiFixture, type ApiEvent, type ApiTeamStats, type ApiLineup, type ApiStandingsResp,
} from "@/lib/api-football.functions";
import { computeOwnPrediction } from "@/lib/own-prediction";
import { useScanSync } from "@/lib/scan-sync";
import { buildMasterPrediction } from "@/lib/master-engine";
import { AiForecastTab } from "@/components/AiForecastTab";
import { ShimmerRows, ShimmerSummary, ShimmerStats, ShimmerLineups, ShimmerTable } from "@/components/Shimmer";
import { useFavorites, toggleFavorite, FavoriteButton as SharedFavoriteButton, NotificationButton as SharedNotificationButton } from "@/lib/favorites";
import { isSoundEnabled, setSoundEnabled, primeSound, playAlert } from "@/lib/alert-sound";
import { Bell, BellOff } from "lucide-react";
import { toast } from "sonner";
import { cacheFixtures, getCachedFixture } from "@/lib/fixture-cache";

export const Route = createFileRoute("/jogo/$fixtureId")({
  head: () => ({
    meta: [
      { title: "Detalhes da partida — Terror da Bet" },
      { name: "description", content: "Estatísticas completas, eventos, escalações, H2H e classificação da partida." },
    ],
  }),
  component: JogoPage,
});

type Tab = "resumo" | "ia" | "stats" | "escalacoes" | "h2h" | "tabela";

const TABS: [Tab, string][] = [
  ["resumo", "Resumo"],
  ["ia", "Previsão IA"],
  ["stats", "Estatísticas"],
  ["escalacoes", "Escalações"],
  ["h2h", "H2H"],
  ["tabela", "Classificação"],
];

function JogoPage() {
  const { fixtureId } = Route.useParams();
  const id = Number(fixtureId);
  const [tab, setTab] = useState<Tab>("resumo");

  const fetchFixture = useServerFn(getFixture);
  const cachedFixture = useMemo(() => getCachedFixture(id), [id]);
  const fxQ = useQuery({
    queryKey: ["fixture", id],
    queryFn: () => fetchFixture({ data: { id } }),
    initialData: cachedFixture,
    initialDataUpdatedAt: cachedFixture ? Date.now() : undefined,
    staleTime: cachedFixture ? 5 * 60_000 : 0,
    refetchInterval: (q) => {
      const f = q.state.data as ApiFixture | null | undefined;
      return f && LIVE_STATUSES.has(f.fixture.status.short) ? 90_000 : false;
    },
  });

  useEffect(() => {
    const f = fxQ.data;
    if (f && typeof document !== "undefined") {
      cacheFixtures([f]);
      const score = f.goals.home != null ? ` ${f.goals.home}-${f.goals.away}` : "";
      document.title = `${f.teams.home.name} × ${f.teams.away.name}${score} — OneOptiOn`;
    }
  }, [fxQ.data]);

  if (fxQ.isLoading) return <div className="px-3 pt-4"><ShimmerSummary /></div>;
  if (fxQ.error) return <div className="p-4 text-sm text-destructive">Erro: {(fxQ.error as Error).message}</div>;
  const f = fxQ.data;
  if (!f) return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="w-20 h-20 rounded-full bg-black/40 border border-white/5 flex items-center justify-center shadow-2xl">
        <Sparkles className="w-10 h-10 text-primary animate-pulse" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-black uppercase tracking-tighter">Partida não encontrada</h2>
        <p className="text-sm text-muted-foreground max-w-xs mx-auto">
          Os dados desta partida ainda não foram processados ou estão temporariamente indisponíveis.
        </p>
      </div>
      <div className="flex gap-3">
        <Link 
          to="/"
          className="px-6 py-3 rounded-2xl bg-white/5 border border-white/10 text-xs font-black uppercase tracking-widest hover:bg-white/10 transition-all active:scale-95 flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Voltar
        </Link>
        <button 
          onClick={() => fxQ.refetch()}
          className="px-6 py-3 rounded-2xl bg-primary text-primary-foreground text-xs font-black uppercase tracking-widest hover:bg-primary/90 transition-all active:scale-95 flex items-center gap-2 shadow-[0_0_30px_rgba(var(--primary),0.3)]"
        >
          <RefreshCw className="w-4 h-4" />
          Recarregar
        </button>
      </div>
    </div>
  );

  const isLive = LIVE_STATUSES.has(f.fixture.status.short);
  const isFinished = FINISHED_STATUSES.has(f.fixture.status.short);
  const statusText = isLive
    ? f.fixture.status.short === "HT" ? "INTERVALO" : `${f.fixture.status.elapsed ?? 0}'`
    : isFinished ? "ENCERRADO"
    : new Date(f.fixture.date).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="-mx-3">
      <div className="header-glow relative px-3 pt-3 pb-4">
        <BackHeader
          title=""
          extra={
            <div className="flex items-center gap-3 flex-1 min-w-0 pr-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <img src={f.league.logo} alt="" loading="lazy" className="w-3.5 h-3.5 object-contain" />
                  <span className="text-[11px] font-bold truncate uppercase tracking-tight">{f.league.name}</span>
                </div>
                <div className="text-sm font-black truncate">{f.teams.home.name} × {f.teams.away.name}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => window.location.reload()}
                  className="w-8 h-8 rounded-full bg-black/40 border border-white/5 flex items-center justify-center hover:bg-black/60 transition-colors"
                  aria-label="Recarregar"
                >
                  <RefreshCw className="w-4 h-4" />
                </button>
                <FavoriteButton fixtureId={id} />
                <GameNotificationButton fixtureId={id} />
              </div>
            </div>
          }
        />


        <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <div className="flex flex-col items-center gap-1 min-w-0">
            <img src={f.teams.home.logo} alt="" className="w-14 h-14 object-contain" />
            <span className="text-sm font-semibold text-center truncate w-full px-1">{f.teams.home.name}</span>
          </div>
          <div className="flex flex-col items-center gap-1">
            <div className="tabular text-4xl font-display font-bold">
              {f.goals.home ?? "-"} <span className="text-muted-foreground">:</span> {f.goals.away ?? "-"}
            </div>
            <span className={`text-[11px] font-bold ${isLive ? "text-primary" : "text-muted-foreground"}`}>{statusText}</span>
            {f.score.halftime.home != null && (
              <span className="text-[10px] text-muted-foreground tabular">HT {f.score.halftime.home}-{f.score.halftime.away}</span>
            )}
          </div>
          <div className="flex flex-col items-center gap-1 min-w-0">
            <img src={f.teams.away.logo} alt="" className="w-14 h-14 object-contain" />
            <span className="text-sm font-semibold text-center truncate w-full px-1">{f.teams.away.name}</span>
          </div>
        </div>
      </div>

      <div className="sticky top-0 z-20 bg-background/85 backdrop-blur-md border-b border-border/60 px-3">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`shrink-0 px-3 py-3 text-xs font-semibold uppercase tracking-wide border-b-2 transition-colors duration-150 active:scale-[0.97] ${
                tab === k ? "border-primary text-foreground" : "border-transparent text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Todas as abas ficam montadas: ao trocar, o conteúdo já está em cache e aparece instantaneamente. */}
      <div className="px-3 pt-3">
        <TabPane active={tab === "resumo"}>
          <ResumoTab fixtureId={id} home={f.teams.home.id} isLive={isLive} fixture={f} />
        </TabPane>
        <TabPane active={tab === "ia"}>
          <AiForecastTab fixture={f} />
        </TabPane>
        <TabPane active={tab === "stats"}>
          <StatsTab fixtureId={id} home={f.teams.home} away={f.teams.away} isLive={isLive} />
        </TabPane>
        <TabPane active={tab === "escalacoes"}>
          <LineupsTab fixtureId={id} />
        </TabPane>
        <TabPane active={tab === "h2h"}>
          <H2HTab home={f.teams.home.id} away={f.teams.away.id} />
        </TabPane>
        <TabPane active={tab === "tabela"}>
          <StandingsTab league={f.league.id} season={f.league.season} highlight={[f.teams.home.id, f.teams.away.id]} />
        </TabPane>
      </div>
    </div>
  );
}

function FavoriteButton({ fixtureId }: { fixtureId: number }) {
  return <SharedFavoriteButton fixtureId={fixtureId} />;
}

function GameNotificationButton({ fixtureId }: { fixtureId: number }) {
  return <SharedNotificationButton fixtureId={fixtureId} />;
}


/** Mantém a aba montada (dados já carregados) mas escondida quando inativa. */


function TabPane({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div hidden={!active} className={active ? "fade-rise" : undefined}>
      {children}
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

function statNum(stats: ApiTeamStats | undefined, type: string): number {
  const v = stats?.statistics.find((s) => s.type === type)?.value;
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? (n as number) : 0;
}

/** Barra tripla de probabilidade 1 / X / 2. */
function ProbBar({ h, d, a }: { h: number; d: number; a: number }) {
  const t = h + d + a || 1;
  const hp = (h / t) * 100, dp = (d / t) * 100, ap = (a / t) * 100;
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Sparkles className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Probabilidade IA de vitória</span>
      </div>
      <div className="flex h-2 rounded-full overflow-hidden bg-muted">
        <div style={{ width: `${hp}%` }} className="bg-emerald-400 transition-all duration-500" />
        <div style={{ width: `${dp}%` }} className="bg-amber-400 transition-all duration-500" />
        <div style={{ width: `${ap}%` }} className="bg-sky-400 transition-all duration-500" />
      </div>
      <div className="mt-2 grid grid-cols-3 text-center">
        <div>
          <div className="text-lg font-black tabular text-emerald-400">{Math.round(hp)}%</div>
          <div className="text-[9px] uppercase text-muted-foreground">Casa</div>
        </div>
        <div>
          <div className="text-lg font-black tabular text-amber-400">{Math.round(dp)}%</div>
          <div className="text-[9px] uppercase text-muted-foreground">Empate</div>
        </div>
        <div>
          <div className="text-lg font-black tabular text-sky-400">{Math.round(ap)}%</div>
          <div className="text-[9px] uppercase text-muted-foreground">Fora</div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, tone = "default" }: { label: string; value: string | number; tone?: "default" | "good" | "warn" }) {
  const cls = tone === "good" ? "text-emerald-400" : tone === "warn" ? "text-amber-300" : "text-foreground";
  return (
    <div className="rounded-xl bg-card border border-border/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground truncate">{label}</div>
      <div className={`text-lg font-black tabular ${cls}`}>{value}</div>
    </div>
  );
}

/** Cards ricos no topo do Resumo: chutes, cartões, escanteios, posse. */
function LiveHighlightCards({ fixtureId, isLive, homeName, awayName }: { fixtureId: number; isLive: boolean; homeName: string; awayName: string }) {
  const fn = useServerFn(getFixtureStatistics);
  const q = useQuery({
    queryKey: ["stats", fixtureId],
    queryFn: () => fn({ data: { id: fixtureId } }),
    refetchInterval: isLive ? 90_000 : false,
    staleTime: isLive ? 60_000 : 6 * 60 * 60_000,
  });
  const data = q.data as ApiTeamStats[] | undefined;
  if (q.isLoading) return <ShimmerRows rows={2} height="h-16" />;
  if (!data || data.length < 2) return null;
  const [h, a] = data;
  const items: [string, string, string][] = [
    ["Posse de bola", String(h.statistics.find((s) => s.type === "Ball Possession")?.value ?? "—"), String(a.statistics.find((s) => s.type === "Ball Possession")?.value ?? "—")],
    ["Chutes no gol", String(statNum(h, "Shots on Goal")), String(statNum(a, "Shots on Goal"))],
    ["Escanteios", String(statNum(h, "Corner Kicks")), String(statNum(a, "Corner Kicks"))],
    ["Cartões", String(statNum(h, "Yellow Cards") + statNum(h, "Red Cards")), String(statNum(a, "Yellow Cards") + statNum(a, "Red Cards"))],
  ];
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center text-[10px] uppercase tracking-wide text-muted-foreground mb-2">
        <span className="truncate">{homeName}</span>
        <span>Destaques</span>
        <span className="truncate text-right">{awayName}</span>
      </div>
      <div className="grid gap-1.5">
        {items.map(([label, hv, av]) => (
          <div key={label} className="grid grid-cols-[3rem_1fr_3rem] items-center gap-2">
            <span className="text-sm font-bold tabular">{hv}</span>
            <span className="text-[10px] text-muted-foreground text-center">{label}</span>
            <span className="text-sm font-bold tabular text-right">{av}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Destaques de jogadores a partir dos eventos (gols, assistências, cartões). */
function TopPlayers({ events }: { events: ApiEvent[] }) {
  const players = useMemo(() => {
    const map = new Map<string, { name: string; team: string; goals: number; assists: number; cards: number }>();
    for (const e of events) {
      const name = e.player?.name;
      if (name) {
        const p = map.get(name) ?? { name, team: e.team.name, goals: 0, assists: 0, cards: 0 };
        if (e.type === "Goal") p.goals++;
        if (e.type === "Card") p.cards++;
        map.set(name, p);
      }
      const assist = e.assist?.name;
      if (assist && e.type === "Goal") {
        const p = map.get(assist) ?? { name: assist, team: e.team.name, goals: 0, assists: 0, cards: 0 };
        p.assists++;
        map.set(assist, p);
      }
    }
    return [...map.values()]
      .map((p) => ({ ...p, rating: Math.min(10, 6 + p.goals * 1.2 + p.assists * 0.7 - p.cards * 0.3) }))
      .filter((p) => p.goals > 0 || p.assists > 0)
      .sort((x, y) => y.rating - x.rating)
      .slice(0, 4);
  }, [events]);

  if (players.length === 0) return null;
  return (
    <div className="rounded-2xl bg-card border border-border/60 p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Star className="w-3.5 h-3.5 text-primary" />
        <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Melhores em campo</span>
      </div>
      <div className="grid gap-1.5">
        {players.map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="text-sm truncate flex-1">{p.name}</span>
            <span className="text-[10px] text-muted-foreground truncate max-w-[35%]">{p.team}</span>
            <span className="text-[10px] text-muted-foreground tabular">{p.goals}G {p.assists}A</span>
            <span className="text-xs font-black tabular px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
              {p.rating.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResumoTab({ fixtureId, home, isLive, fixture }: { fixtureId: number; home: number; isLive: boolean; fixture: ApiFixture }) {
  const isFinished = FINISHED_STATUSES.has(fixture.fixture.status.short);
  const isUpcoming = !isLive && !isFinished;

  const fn = useServerFn(getFixtureEvents);
  const q = useQuery({
    queryKey: ["events", fixtureId],
    queryFn: () => fn({ data: { id: fixtureId } }),
    refetchInterval: isLive ? 90_000 : false,
    staleTime: isLive ? 60_000 : 6 * 60 * 60_000,
    enabled: !isUpcoming,
  });

  const venueText = [fixture.fixture.venue.name, fixture.fixture.venue.city].filter(Boolean).join(" · ");
  const dateText = new Date(fixture.fixture.date).toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const header = (
    <div className="mb-3 rounded-xl bg-card border border-border/60 px-3 py-2 text-[11px] text-muted-foreground grid gap-1">
      <div className="flex items-center gap-1.5"><span className="text-primary">📅</span><span>{dateText}</span></div>
      {venueText && <div className="flex items-center gap-1.5"><MapPin className="w-3 h-3 text-primary" /><span className="truncate">{venueText}</span></div>}
      {fixture.fixture.referee && <div className="flex items-center gap-1.5"><User className="w-3 h-3 text-primary" /><span className="truncate">Árbitro: {fixture.fixture.referee}</span></div>}
    </div>
  );

  return (
    <div className="space-y-3">
      {header}
      <AiPredictionCards fixture={fixture} />
      {!isUpcoming && (
        <LiveHighlightCards
          fixtureId={fixtureId}
          isLive={isLive}
          homeName={fixture.teams.home.name}
          awayName={fixture.teams.away.name}
        />
      )}
      {isUpcoming ? (
        <PreviewCard fixture={fixture} />
      ) : q.isLoading ? (
        <ShimmerRows rows={5} height="h-12" />
      ) : !q.data || q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sem eventos ainda.</p>
      ) : (
        <>
          <TopPlayers events={q.data as ApiEvent[]} />
          <ul className="space-y-2">
            {(q.data as ApiEvent[]).map((e, i) => {
              const isHome = e.team.id === home;
              return (
                <li key={i} className={`flex items-center gap-2 rounded-xl bg-card border border-border/60 px-3 py-2 ${isHome ? "" : "flex-row-reverse text-right"}`}>
                  <span className="text-xs tabular w-8 text-muted-foreground shrink-0">{e.time.elapsed}'{e.time.extra ? `+${e.time.extra}` : ""}</span>
                  <span className="text-lg shrink-0">{eventIcon(e)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm truncate">{e.player.name ?? "—"}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{e.detail}{e.assist.name ? ` · assist. ${e.assist.name}` : ""}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** Bloco de predição própria (Poisson + Dixon-Coles) exibido no topo do Resumo. */
function AiPredictionCards({ fixture }: { fixture: ApiFixture }) {
  const fn = useServerFn(getMatchPreview);
  const q = useQuery({
    queryKey: ["preview", fixture.fixture.id],
    queryFn: () => fn({ data: { homeId: fixture.teams.home.id, awayId: fixture.teams.away.id, last: 5 } }),
    staleTime: 45 * 60_000,
  });
  useScanSync(fixture.fixture.id, fixture.teams.home.name, fixture.teams.away.name, q.data ?? undefined);
  const pred = useMemo(() => (q.data ? computeOwnPrediction(q.data.home, q.data.away) : null), [q.data]);
  const master = useMemo(() => (pred?.ready ? buildMasterPrediction(pred) : null), [pred]);

  if (q.isLoading) return <ShimmerSummary />;
  if (!pred || !pred.ready || !master) return null;

  return (
    <div className="space-y-2">
      <ProbBar h={pred.pHome} d={pred.pDraw} a={pred.pAway} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MiniStat label="Gols esperados" value={pred.expectedGoals.toFixed(2)} />
        <MiniStat label="Escanteios esp." value={pred.expectedCorners.toFixed(1)} />
        <MiniStat label="Over 2.5" value={`${Math.round(pred.pOver25 * 100)}%`} tone={pred.pOver25 > 0.55 ? "good" : "default"} />
        <MiniStat label="Ambas marcam" value={`${Math.round(pred.pBTTS * 100)}%`} tone={pred.pBTTS > 0.55 ? "good" : "default"} />
      </div>
      {master.exactScores.length > 0 && (
        <div className="rounded-2xl bg-card border border-border/60 p-3">
          <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
            Placares mais prováveis · tendência {master.trend.label}
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-none">
            {master.exactScores.slice(0, 6).map((s) => (
              <div key={s.label} className={`shrink-0 rounded-xl border px-3 py-2 text-center min-w-[68px] ${s.label === master.exactScore.label ? "bg-primary/15 border-primary/50" : "bg-black/30 border-white/10"}`}>
                <div className={`text-sm font-black tabular ${s.label === master.exactScore.label ? "text-primary" : ""}`}>{s.label}</div>
                <div className="text-[10px] text-primary tabular">{Math.round(s.p * 100)}%</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="rounded-2xl bg-primary/10 border border-primary/30 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-bold text-foreground">Palpite Estratégico OneOption</span>
        </div>
        <p className="text-[10px] text-muted-foreground leading-relaxed">
          Tendência {master.trend.label} (casa {Math.round(pred.pHome * 100)}% · empate {Math.round(pred.pDraw * 100)}% · fora {Math.round(pred.pAway * 100)}%).
          Linha de gols: {master.goals.line} ({Math.round(master.goals.p * 100)}%) · placar sugerido {master.exactScore.label} · HT/FT {master.htFt.primary}.
          {master.problems.length > 0 && ` Ajustes automáticos: ${master.problems.length}.`}
        </p>
      </div>
    </div>
  );
}

function PreviewCard({ fixture }: { fixture: ApiFixture }) {
  const fn = useServerFn(getMatchPreview);
  const q = useQuery({
    queryKey: ["preview", fixture.fixture.id],
    queryFn: () => fn({ data: { homeId: fixture.teams.home.id, awayId: fixture.teams.away.id, last: 5 } }),
    staleTime: 45 * 60_000,
  });
  if (q.isLoading) return <ShimmerRows rows={6} height="h-10" />;
  if (!q.data) return <p className="text-sm text-muted-foreground py-8 text-center">Sem dados para preview.</p>;
  const { home, away, last } = q.data;
  if (home.played === 0 && away.played === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">Times sem histórico recente para preview.</p>;
  }

  const rows: { label: string; h: string | number; a: string | number; hint?: string }[] = [
    { label: "Jogos analisados", h: home.played, a: away.played },
    { label: "Forma", h: home.form || "—", a: away.form || "—", hint: "recente → antigo" },
    { label: "Gols marcados / jogo", h: home.goalsForAvg, a: away.goalsForAvg },
    { label: "Gols sofridos / jogo", h: home.goalsAgainstAvg, a: away.goalsAgainstAvg },
    {
      label: "Escanteios a favor / jogo", h: home.cornersForAvg, a: away.cornersForAvg,
      hint: home.cornersEstimated || away.cornersEstimated
        ? "estimado (liga sem dados)"
        : `amostra ${home.cornersSample}v${away.cornersSample} jogos`,
    },
    { label: "Escanteios contra / jogo", h: home.cornersAgainstAvg, a: away.cornersAgainstAvg },
    { label: "Total escanteios / jogo", h: home.cornersTotalAvg, a: away.cornersTotalAvg },

    { label: "Chutes no gol / jogo", h: home.shotsOnGoalAvg, a: away.shotsOnGoalAvg },
    { label: "Cartões / jogo", h: home.cardsAvg, a: away.cardsAvg },
    { label: "BTTS %", h: `${home.bttsPct}%`, a: `${away.bttsPct}%` },
    { label: "Over 2.5 %", h: `${home.over25Pct}%`, a: `${away.over25Pct}%` },
    { label: "Clean sheet %", h: `${home.cleanSheetPct}%`, a: `${away.cleanSheetPct}%` },
    { label: "Não marcou %", h: `${home.failedToScorePct}%`, a: `${away.failedToScorePct}%` },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-card border border-border/60 p-3">
        <div className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">
          Preview · últimos {last} jogos
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <img src={fixture.teams.home.logo} alt="" loading="lazy" className="w-6 h-6 object-contain shrink-0" />
            <span className="text-xs font-semibold truncate">{fixture.teams.home.name}</span>
          </div>
          <span className="text-[10px] text-muted-foreground">vs</span>
          <div className="flex items-center gap-2 min-w-0 justify-end">
            <span className="text-xs font-semibold truncate text-right">{fixture.teams.away.name}</span>
            <img src={fixture.teams.away.logo} alt="" loading="lazy" className="w-6 h-6 object-contain shrink-0" />
          </div>
        </div>

        <div className="divide-y divide-border/40">
          {rows.map((r) => (
            <div key={r.label} className="grid grid-cols-[1fr_auto_1fr] gap-2 py-1.5 items-center">
              <span className="text-sm font-semibold tabular">{r.h}</span>
              <span className="text-[10px] text-muted-foreground text-center">
                {r.label}
                {r.hint && <span className="block text-[9px] opacity-60">{r.hint}</span>}
              </span>
              <span className="text-sm font-semibold tabular text-right">{r.a}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {([["home", home, fixture.teams.home], ["away", away, fixture.teams.away]] as const).map(([k, s, team]) => (
          <div key={k} className="rounded-2xl bg-card border border-border/60 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <img src={team.logo} alt="" loading="lazy" className="w-4 h-4 object-contain" />
              <span className="text-xs font-semibold truncate">{team.name}</span>
            </div>
            <ul className="space-y-1">
              {s.lastResults.map((r, i) => (
                <li key={i} className="flex items-center gap-1.5 text-[11px]">
                  <span className={`w-4 text-center font-bold ${r.result === "V" ? "text-emerald-400" : r.result === "D" ? "text-destructive" : "text-amber-400"}`}>{r.result}</span>
                  <span className="text-muted-foreground">{r.home ? "vs" : "@"}</span>
                  <span className="truncate flex-1">{r.opp}</span>
                  <span className="tabular font-semibold">{r.gf}–{r.ga}</span>
                </li>
              ))}
              {s.lastResults.length === 0 && <li className="text-[11px] text-muted-foreground">Sem jogos recentes.</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function pct(v: number | string | null) {
  if (v == null) return 0;
  if (typeof v === "string" && v.endsWith("%")) return Number(v.slice(0, -1));
  return Number(v) || 0;
}

function StatsTab({ fixtureId, home, away, isLive }: { fixtureId: number; home: { name: string }; away: { name: string }; isLive: boolean }) {
  const fn = useServerFn(getFixtureStatistics);
  const q = useQuery({
    queryKey: ["stats", fixtureId],
    queryFn: () => fn({ data: { id: fixtureId } }),
    refetchInterval: isLive ? 60_000 : false,
    staleTime: isLive ? 0 : 6 * 60 * 60_000,
  });
  if (q.isLoading) return <ShimmerStats />;
  if (!q.data || q.data.length < 2) return <p className="text-sm text-muted-foreground py-8 text-center">Estatísticas ainda não disponíveis.</p>;
  const [h, a] = q.data as ApiTeamStats[];
  const types = h.statistics.map((s) => s.type);

  const LABELS: Record<string, string> = {
    "Ball Possession": "Posse de bola",
    "Total Shots": "Chutes totais",
    "Shots on Goal": "Chutes no gol",
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
    "expected_goals": "xG",
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold px-1">
        <span className="truncate max-w-[40%]">{home.name}</span>
        <span className="text-muted-foreground">vs</span>
        <span className="truncate max-w-[40%] text-right">{away.name}</span>
      </div>
      {types.map((t, i) => {
        const hv = h.statistics[i]?.value ?? 0;
        const av = a.statistics.find((s) => s.type === t)?.value ?? 0;
        const hn = pct(hv);
        const an = pct(av);
        const total = hn + an;
        const hp = total > 0 ? (hn / total) * 100 : 50;
        return (
          <div key={t}>
            <div className="flex items-center justify-between text-xs mb-1 tabular">
              <span className="font-semibold w-12">{hv ?? 0}</span>
              <span className="text-muted-foreground">{LABELS[t] ?? t}</span>
              <span className="font-semibold w-12 text-right">{av ?? 0}</span>
            </div>
            <div className="flex h-1.5 rounded-full overflow-hidden bg-muted">
              <div style={{ width: `${hp}%` }} className="bg-primary transition-all duration-500" />
              <div style={{ width: `${100 - hp}%` }} className="bg-destructive/70 transition-all duration-500" />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Agrupa os titulares em linhas conforme a formação (ex.: "4-1-4-1"). */
function formationRows(l: ApiLineup): ApiLineup["startXI"][] {
  const parts = (l.formation ?? "").split("-").map((n) => Number(n)).filter((n) => n > 0);
  const xi = [...l.startXI];
  const gk = xi.filter((p) => p.player.pos === "G");
  const rest = xi.filter((p) => p.player.pos !== "G");
  const rows: ApiLineup["startXI"][] = [gk.length ? gk : rest.splice(0, 1)];
  if (parts.length === 0) {
    while (rest.length) rows.push(rest.splice(0, 4));
    return rows;
  }
  for (const n of parts) rows.push(rest.splice(0, n));
  if (rest.length) rows.push(rest);
  return rows.filter((r) => r.length > 0);
}

function PlayerDot({ p, tone }: { p: ApiLineup["startXI"][number]; tone: "home" | "away" }) {
  const ring = tone === "home" ? "bg-emerald-500/25 border-emerald-400/60 text-emerald-100" : "bg-sky-500/25 border-sky-400/60 text-sky-100";
  const last = (p.player.name ?? "").split(" ").slice(-1)[0];
  return (
    <div className="flex flex-col items-center gap-0.5 w-14">
      <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-[11px] font-black tabular ${ring}`}>
        {p.player.number ?? "-"}
      </div>
      <span className="text-[9px] leading-tight text-center text-foreground/90 truncate w-full">{last}</span>
    </div>
  );
}

function LineupsTab({ fixtureId }: { fixtureId: number }) {
  const fn = useServerFn(getFixtureLineups);
  const q = useQuery({
    queryKey: ["lineups", fixtureId],
    queryFn: async () => (await fn({ data: { id: fixtureId } })) as ApiLineup[],
    staleTime: 60 * 60_000,
  });
  if (q.isLoading) return <ShimmerLineups />;
  const data = q.data as ApiLineup[] | undefined;
  if (!data || data.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">Escalações ainda não confirmadas.</p>;

  const [homeL, awayL] = data;

  return (
    <div className="space-y-3">
      {/* Campo tático */}
      <div className="rounded-2xl border border-border/60 overflow-hidden bg-[linear-gradient(180deg,oklch(0.32_0.07_150)_0%,oklch(0.26_0.06_150)_50%,oklch(0.32_0.07_150)_100%)]">
        <div className="flex items-center justify-between px-3 py-2 bg-black/35">
          <div className="flex items-center gap-1.5 min-w-0">
            <img src={homeL.team.logo} alt="" loading="lazy" className="w-5 h-5 object-contain shrink-0" />
            <span className="text-xs font-bold truncate">{homeL.team.name}</span>
            <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-emerald-500/25 text-emerald-200 tabular shrink-0">{homeL.formation}</span>
          </div>
          {awayL && (
            <div className="flex items-center gap-1.5 min-w-0 justify-end">
              <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-sky-500/25 text-sky-200 tabular shrink-0">{awayL.formation}</span>
              <span className="text-xs font-bold truncate">{awayL.team.name}</span>
              <img src={awayL.team.logo} alt="" loading="lazy" className="w-5 h-5 object-contain shrink-0" />
            </div>
          )}
        </div>

        <div className="relative px-2 py-3">
          <div className="absolute left-3 right-3 top-1/2 h-px bg-white/25" />
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full border border-white/25" />
          <div className="relative grid gap-3">
            {formationRows(homeL).map((row, i) => (
              <div key={`h-${i}`} className="flex justify-evenly">
                {row.map((p) => <PlayerDot key={p.player.id ?? p.player.name} p={p} tone="home" />)}
              </div>
            ))}
          </div>
          {awayL && (
            <div className="relative grid gap-3 mt-3">
              {formationRows(awayL).reverse().map((row, i) => (
                <div key={`a-${i}`} className="flex justify-evenly">
                  {row.map((p) => <PlayerDot key={p.player.id ?? p.player.name} p={p} tone="away" />)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Listas */}
      <div className="grid grid-cols-2 gap-3">
        {data.map((l) => (
          <div key={l.team.id} className="rounded-2xl bg-card border border-border/60 p-3">
            <div className="flex items-center gap-2 mb-2">
              <img src={l.team.logo} alt="" loading="lazy" className="w-6 h-6 object-contain" />
              <div className="min-w-0">
                <div className="text-sm font-semibold truncate">{l.team.name}</div>
                <div className="text-[11px] text-muted-foreground tabular">{l.formation}</div>
              </div>
            </div>
            <div className="text-[11px] font-semibold uppercase text-muted-foreground mt-2 mb-1">Titulares</div>
            <ul className="space-y-1">
              {l.startXI.map((p) => (
                <li key={p.player.id} className="flex items-center gap-2 text-xs">
                  <span className="w-5 text-center tabular text-primary font-bold">{p.player.number}</span>
                  <span className="truncate">{p.player.name}</span>
                  <span className="ml-auto text-muted-foreground text-[10px]">{p.player.pos}</span>
                </li>
              ))}
            </ul>
            {l.substitutes.length > 0 && (
              <>
                <div className="text-[11px] font-semibold uppercase text-muted-foreground mt-3 mb-1">Reservas</div>
                <ul className="space-y-1">
                  {l.substitutes.map((p) => (
                    <li key={p.player.id} className="flex items-center gap-2 text-xs">
                      <span className="w-5 text-center tabular text-muted-foreground">{p.player.number}</span>
                      <span className="truncate">{p.player.name}</span>
                      <span className="ml-auto text-muted-foreground text-[10px]">{p.player.pos}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {l.coach?.name && (
              <div className="mt-3 text-[11px] text-muted-foreground">Técnico: {l.coach.name}</div>
            )}
          </div>
        ))}
      </div>
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
  if (q.isLoading) return <ShimmerRows rows={6} height="h-14" />;
  if (!q.data || q.data.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">Sem histórico de confrontos.</p>;
  return (
    <ul className="space-y-2">
      {(q.data as ApiFixture[]).map((m) => (
        <Link
          key={m.fixture.id}
          to="/jogo/$fixtureId"
          params={{ fixtureId: String(m.fixture.id) }}
          className="grid grid-cols-[auto_1fr_auto] items-center gap-2 rounded-xl bg-card border border-border/60 px-3 py-2"
        >
          <span className="text-[10px] text-muted-foreground tabular w-14">{new Date(m.fixture.date).toLocaleDateString("pt-BR")}</span>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <img src={m.teams.home.logo} alt="" loading="lazy" className="w-4 h-4 object-contain shrink-0" />
              <span className="truncate">{m.teams.home.name}</span>
            </div>
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <img src={m.teams.away.logo} alt="" loading="lazy" className="w-4 h-4 object-contain shrink-0" />
              <span className="truncate">{m.teams.away.name}</span>
            </div>
          </div>
          <div className="tabular text-sm font-bold text-center">
            <div>{m.goals.home ?? "-"}</div>
            <div>{m.goals.away ?? "-"}</div>
          </div>
        </Link>
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
  if (q.isLoading) return <ShimmerTable />;
  const resp = q.data as ApiStandingsResp[] | undefined;
  const table = resp?.[0]?.league.standings?.[0];
  if (!table || table.length === 0) return <p className="text-sm text-muted-foreground py-8 text-center">Classificação indisponível.</p>;
  return (
    <div className="rounded-2xl bg-card border border-border/60 overflow-hidden">
      <div className="grid grid-cols-[24px_1fr_28px_28px_28px_28px_36px_36px] gap-1 px-2 py-2 text-[10px] uppercase text-muted-foreground font-semibold border-b border-border/50">
        <span>#</span><span>Time</span><span className="text-center">P</span><span className="text-center">V</span><span className="text-center">E</span><span className="text-center">D</span><span className="text-center">SG</span><span className="text-center">Pts</span>
      </div>
      {table.map((row) => {
        const hi = highlight.includes(row.team.id);
        return (
          <div key={row.team.id} className={`grid grid-cols-[24px_1fr_28px_28px_28px_28px_36px_36px] gap-1 px-2 py-2 text-xs tabular items-center ${hi ? "bg-primary/10" : ""}`}>
            <span className="text-muted-foreground">{row.rank}</span>
            <div className="flex items-center gap-1.5 min-w-0">
              <img src={row.team.logo} alt="" loading="lazy" className="w-4 h-4 object-contain shrink-0" />
              <span className="truncate">{row.team.name}</span>
            </div>
            <span className="text-center">{row.all.played}</span>
            <span className="text-center">{row.all.win}</span>
            <span className="text-center">{row.all.draw}</span>
            <span className="text-center">{row.all.lose}</span>
            <span className="text-center text-muted-foreground">{row.goalsDiff}</span>
            <span className="text-center font-bold">{row.points}</span>
          </div>
        );
      })}
    </div>
  );
}
