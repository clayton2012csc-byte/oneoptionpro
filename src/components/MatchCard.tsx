import { Link, useNavigate } from "@tanstack/react-router";
import { RefreshCw, X, FolderPlus, BrainCircuit, Star, Sparkles } from "lucide-react";

import type { ApiTeam, BingaoOdds } from "@/lib/api-football.functions";
import { memo, useEffect, useRef, useState, useMemo } from "react";
import { useFavorites, toggleFavorite, FavoriteButton as SharedFavoriteButton } from "@/lib/favorites";

import { useQueryClient, useIsFetching, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { LIVE_STATUSES, FINISHED_STATUSES, getBingaoOdds, type ApiFixture, getMatchPreview, getFixtureStatistics } from "@/lib/api-football.functions";
import { setSelectedFixture, isDesktopThreeCol, useSelectedFixture } from "@/lib/selected-fixture";
import { toggleFixture, usePinnedSections, type SectionId } from "@/lib/pinned-sections";
import { useActiveSection } from "@/lib/active-section";
import { useMarketFilter } from "@/lib/market-filter";
import { computeOwnPrediction, pctFmt } from "@/lib/own-prediction";
import { autoTicketStatus } from "@/lib/auto-tickets.functions";
import { isSoundEnabled, setSoundEnabled, primeSound, playAlert } from "@/lib/alert-sound";
import { toast } from "sonner";

const PIN_SECTIONS: { id: SectionId; icon: string; label: string }[] = [
  { id: "bingao", icon: "🎯", label: "Bingão" },
  { id: "loteca", icon: "🎟️", label: "Lotéca IA" },
  { id: "beta", icon: "🧪", label: "Beta" },
  { id: "alfha", icon: "⚡", label: "Alfha" },
];


function statusLabel(f: ApiFixture) {
  const s = f.fixture.status.short;
  if (LIVE_STATUSES.has(s)) {
    if (s === "HT") return { text: "HT", live: true };
    const elapsed = f.fixture.status.elapsed ?? 0;
    return { text: `${elapsed}'`, live: true };
  }
  if (FINISHED_STATUSES.has(s)) return { text: s === "FT" ? "FT" : s, live: false, finished: true };
  // upcoming: show time
  const d = new Date(f.fixture.date);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { text: `${hh}:${mm}`, live: false, finished: false };
}

function MatchCardBase({ fixture }: { fixture: ApiFixture }) {
  const st = statusLabel(fixture);
  const homeGoals = fixture.goals.home;
  const awayGoals = fixture.goals.away;
  const scored = homeGoals != null && awayGoals != null;
  const homeWinner = scored && (homeGoals ?? 0) > (awayGoals ?? 0);
  const awayWinner = scored && (awayGoals ?? 0) > (homeGoals ?? 0);
  const selected = useSelectedFixture();
  const isSelected = selected === fixture.fixture.id;
  const { market, predictions } = useMarketFilter();
  const fetchStats = useServerFn(getFixtureStatistics);
  
  // Lazy Loading: Monitora se o card está na tela para carregar estatísticas e previsões
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [isNearScreen, setIsNearScreen] = useState(false);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setIsNearScreen(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsNearScreen(true);
        io.disconnect();
      }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { data: stats } = useQuery({
    queryKey: ["fixture-statistics", fixture.fixture.id],
    queryFn: () => fetchStats({ data: { id: fixture.fixture.id } }),
    enabled: isNearScreen && (st.live || st.finished),
    staleTime: 30_000,
  });

  const getStat = (teamId: number, type: string) => {
    const teamStats = stats?.find(s => s.team.id === teamId);
    const s = teamStats?.statistics?.find(x => x.type === type);
    return s?.value != null ? Number(s.value) : 0;
  };

  const cornersH = getStat(fixture.teams.home.id, "Corner Kicks");
  const cornersA = getStat(fixture.teams.away.id, "Corner Kicks");
  const hasStats = stats && stats.length > 0;

  // Selo "IA Pronta": jogo já processado pelo robô de bilhetes automáticos (11 mercados salvos)
  const fetchAutoStatus = useServerFn(autoTicketStatus);
  const { data: autoStatus } = useQuery({
    queryKey: ["auto-ticket-status"],
    queryFn: () => fetchAutoStatus(),
    staleTime: 60_000,
  });
  const iaPronta = !!autoStatus?.ids?.includes(fixture.fixture.id);


  return (
    <Link
      ref={cardRef}
      to="/jogo/$fixtureId"
      params={{ fixtureId: String(fixture.fixture.id) }}
      onClick={(e) => {
        if (isDesktopThreeCol()) {
          e.preventDefault();
          setSelectedFixture(fixture.fixture.id);
        }
      }}
      className={`flex flex-col gap-3 rounded-[2rem] p-5 relative group transition-all duration-700 border border-white/5 overflow-hidden shadow-2xl ${
        st.live ? "ring-1 ring-primary/40 shadow-[0_0_30px_rgba(var(--primary),0.1)]" : "hover:border-primary/40 hover:shadow-[0_0_40px_rgba(var(--primary),0.05)]"
      } ${isSelected ? "ring-2 ring-primary border-primary/50" : ""}`}
    >
      {/* Background with full gradient and carbon fiber pattern */}
      <div className="absolute inset-0 bg-gradient-to-br from-neutral-700 via-neutral-800 to-neutral-900 group-hover:from-neutral-600 group-hover:via-neutral-700 group-hover:to-neutral-800 transition-all duration-700 -z-10" />
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-[0.08] pointer-events-none -z-10" />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/20 pointer-events-none -z-10" />

      
      {/* Top Bar: League & Status */}
      <div className="flex items-center justify-between relative z-10 px-1">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-lg bg-black/40 flex items-center justify-center border border-white/5 p-1 shadow-inner group-hover:border-primary/20 transition-colors">
            <img src={fixture.league.logo} alt="" className="w-full h-full object-contain filter drop-shadow-sm" loading="lazy" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-black text-white/80 uppercase tracking-widest leading-none">
              {fixture.league.name}
            </span>
            <span className="text-[8px] font-bold text-muted-foreground/50 uppercase tracking-tighter mt-0.5">
              {fixture.league.country}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {iaPronta && (
            <span
              title="IA Pronta: estatísticas e previsões dos 11 mercados já carregadas e salvas no banco"
              className="flex items-center gap-1 px-2 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)]"
            >
              <Sparkles className="w-3 h-3" />
              <span className="text-[8px] font-black uppercase tracking-widest">IA Pronta</span>
            </span>
          )}
          {/* Status/Time in Top Bar */}
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded-xl border transition-all duration-500 ${st.live ? "bg-primary/20 text-primary border-primary/30 shadow-[0_0_15px_rgba(var(--primary),0.2)]" : "bg-black/60 text-white/40 border-white/5"}`}>
            {st.live && <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.6)]" />}
            <span className="text-[10px] font-black tabular tracking-widest uppercase">
              {st.text}
            </span>
            {hasStats && (
              <div className="flex items-center gap-1 ml-1 pl-2 border-l border-white/10">
                <span className="text-[10px]">🚩</span>
                <span className="text-[10px] font-black tabular">{cornersH + cornersA}</span>
              </div>
            )}
          </div>
          
          <div className="flex items-center" onClick={e => e.stopPropagation()}>
            <input 
              type="checkbox" 
              className="w-4 h-4 rounded-md border-white/10 bg-black/40 checked:bg-primary transition-all cursor-pointer hover:border-primary/40 focus:ring-0 focus:ring-offset-0"
              aria-label="Selecionar jogo"
            />
          </div>
        </div>
      </div>

      {/* Main Content: Teams & Scores */}
      <div className="relative z-10 flex items-center justify-between gap-4 py-3 min-h-[100px]">
        {/* Background Team Logos - Adjusted to not block score */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden flex items-center justify-center z-0 opacity-[0.20] group-hover:opacity-[0.25] transition-opacity duration-700">
           <img src={fixture.teams.home.logo} alt="" className="absolute -left-10 w-48 h-48 object-contain filter brightness-125" />
           <img src={fixture.teams.away.logo} alt="" className="absolute -right-10 w-48 h-48 object-contain filter brightness-125" />
        </div>

        {/* Teams Layout */}
        <div className="flex-1 space-y-5 z-10">
          <TeamRowModern team={fixture.teams.home} goals={homeGoals} isWinner={homeWinner} isFinished={st.finished || false} />
          <TeamRowModern team={fixture.teams.away} goals={awayGoals} isWinner={awayWinner} isFinished={st.finished || false} />
        </div>
      </div>

      {/* Footer: Market Odds & Shortcuts */}
      <div className="relative z-10 pt-4 mt-2 border-t border-white/5 flex items-center justify-between gap-4">
        <div className="flex-1 overflow-x-auto scrollbar-none">
          <OddsStrip fixtureId={fixture.fixture.id} enabled={!st.finished} />
        </div>
        
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="flex items-center gap-1 bg-white/5 px-2 py-1.5 rounded-xl border border-white/5 shadow-inner">
            <FavoriteButton fixtureId={fixture.fixture.id} />
            <NotificationButton fixtureId={fixture.fixture.id} />
          </div>
          <div className="flex items-center gap-1 bg-primary/5 px-2 py-1.5 rounded-xl border border-primary/10 shadow-inner">
            <PinShortcuts fixtureId={fixture.fixture.id} />
            <RefreshButton />
          </div>
        </div>
      </div>

      {/* Floating Badges - Positioned top right but below top bar */}
      {market !== "none" && <ProbabilityBadge fixture={fixture} isSelected={isSelected} />}
    </Link>
  );
}

function TeamRowModern({ team, goals, isWinner, isFinished }: { team: ApiTeam; goals: number | null; isWinner: boolean; isFinished: boolean }) {

  const navigate = useNavigate();
  const openTeam = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate({ to: "/time/$teamId", params: { teamId: String(team.id) } });
  };
  return (
    <div className="flex items-center justify-between gap-4 min-w-0">
      <div className="flex items-center gap-4 min-w-0">
        <div className="relative group/logo shrink-0">
          <div className="absolute inset-0 bg-primary/20 rounded-2xl blur-lg opacity-0 group-hover/logo:opacity-100 transition-opacity duration-500" />
          <button onClick={openTeam} className="relative w-11 h-11 flex items-center justify-center bg-black/40 rounded-2xl border border-white/5 group-hover:border-primary/40 transition-all duration-300 shadow-xl" aria-label={`Ver ${team.name}`}>
            <img src={team.logo} alt="" className="w-7 h-7 object-contain filter drop-shadow-md group-hover:scale-110 transition-transform duration-300" loading="lazy" />
          </button>
        </div>
        <button
          onClick={openTeam}
          className={`text-lg font-black tracking-tight truncate text-left hover:text-primary transition-colors duration-300 ${isFinished && !isWinner && goals !== null ? "text-white/30" : "text-white"}`}
        >
          {team.name}
        </button>
      </div>
      {goals !== null && (
        <div className={`min-w-[42px] h-11 flex items-center justify-center rounded-2xl border transition-all duration-300 shadow-2xl ${isWinner ? "bg-primary/20 border-primary/40 scale-105" : "bg-black/40 border-white/5"}`}>
          <span className={`text-2xl font-black tabular leading-none ${isWinner ? "text-primary drop-shadow-[0_0_12px_rgba(var(--primary),0.5)]" : "text-white/80"}`}>
            {goals}
          </span>
        </div>
      )}
    </div>
  );
}


/** Odds reais estilo Betano (1 · X · 2) — carrega quando o card entra na tela. */
function OddsStrip({ fixtureId, enabled }: { fixtureId: number; enabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const fetchOdds = useServerFn(getBingaoOdds);

  useEffect(() => {
    if (!enabled || visible) return;
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, visible]);

  const { data, isFetching } = useQuery({
    queryKey: ["bingao-odds", fixtureId],
    queryFn: () => fetchOdds({ data: { id: fixtureId } }) as Promise<BingaoOdds | null>,
    enabled: enabled && visible,
    staleTime: 10 * 60_000,
    retry: false,
  });

  if (!enabled) return null;

  const cells = [
    { k: "1", odd: data?.homeWin },
    { k: "X", odd: data?.draw },
    { k: "2", odd: data?.awayWin },
  ];
  const hasAny = cells.some((c) => c.odd);

  return (
    <div ref={ref} onClick={(e) => e.preventDefault()} className="pt-1">
      <div className="grid grid-cols-3 gap-1">
        {cells.map((c) => (
          <div
            key={c.k}
            className="flex items-center justify-between gap-1.5 rounded-lg bg-black/50 border border-white/5 px-2.5 py-1.5 transition-all hover:bg-black/70 hover:border-white/10"
          >
            <span className="text-[10px] font-black text-muted-foreground/50">{c.k}</span>
            <span className="text-[11px] font-black tabular text-foreground">
              {c.odd ? c.odd.toFixed(2) : isFetching || !data ? "—" : "–"}
            </span>
          </div>
        ))}
      </div>
      {hasAny && (
        <div className="flex flex-wrap items-center gap-1 pt-1">
          <span className="text-[8px] uppercase tracking-wider text-muted-foreground/70">{data!.bookmaker}</span>
          {([
            { k: "U2.5", odd: data!.under25 },
            { k: "O2.5", odd: data!.over25 },
            { k: "BTTS", odd: data!.bttsYes },
          ].filter((x) => x.odd) as { k: string; odd: number }[]).map((x) => (
            <span
              key={x.k}
              className="text-[9px] font-bold tabular px-1 py-0.5 rounded border border-white/10 bg-black/30 text-muted-foreground"
            >
              {x.k} <span className="text-foreground">{x.odd.toFixed(2)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


function RefreshButton() {
  const qc = useQueryClient();

  const [spin, setSpin] = useState(false);
  const fetching = useIsFetching() > 0;
  const spinning = spin || fetching;
  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSpin(true);
        qc.invalidateQueries().finally(() => setTimeout(() => setSpin(false), 500));
      }}
      className="w-7 h-7 flex items-center justify-center text-muted-foreground/70 hover:text-primary"
      aria-label="Atualizar dados"
      title="Atualizar dados"
    >
      <RefreshCw className={`w-4 h-4 ${spinning ? "animate-spin" : ""}`} />
    </button>
  );
}

function TeamRow({ team, dim }: { team: ApiTeam; dim: boolean }) {
  const navigate = useNavigate();
  const openTeam = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate({ to: "/time/$teamId", params: { teamId: String(team.id) } });
  };
  return (
    <div className="flex items-center gap-2 min-w-0">
      <button onClick={openTeam} className="shrink-0" aria-label={`Ver ${team.name}`}>
        <img src={team.logo} alt="" className="w-5 h-5 object-contain" loading="lazy" />
      </button>
      <button
        onClick={openTeam}
        className={`text-sm truncate text-left hover:text-primary transition max-w-[140px] md:max-w-full ${dim ? "text-muted-foreground" : ""}`}
      >
        {team.name}
      </button>
    </div>
  );
}

function PinShortcuts({ fixtureId }: { fixtureId: number }) {
  const pinned = usePinnedSections();
  const [mobileOpen, setMobileOpen] = useState(false);
  const anyPinned = PIN_SECTIONS.some((s) => pinned[s.id].includes(fixtureId));
  const buttons = (
    <>
      {PIN_SECTIONS.map((s) => {
        const active = pinned[s.id].includes(fixtureId);
        return (
          <button
            key={s.id}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleFixture(s.id, fixtureId);
            }}
            title={active ? `Remover de ${s.label}` : `Importar para ${s.label}`}
            className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm border transition-all duration-300 transform active:scale-90 ${
              active
                ? "bg-primary text-primary-foreground border-primary shadow-[0_0_10px_rgba(var(--primary),0.3)] scale-105"
                : "bg-black/30 border-white/5 text-white/40 hover:text-white hover:bg-black/50 hover:border-white/20"
            }`}
          >
            {s.icon}
          </button>
        );
      })}
    </>
  );
  return (
    <>
      <div className="flex items-center gap-0.5">{buttons}</div>
    </>
  );
}


function FolderActions({ fixtureId }: { fixtureId: number }) {
  // Removido conforme solicitado para limpar o card
  return null;
}
function ProbabilityBadge({ fixture, isSelected }: { fixture: ApiFixture; isSelected?: boolean }) {
  const { market, predictions, persistedPredictions } = useMarketFilter();
  const pinned = usePinnedSections();
  const fetchPreview = useServerFn(getMatchPreview);


  const { data } = useQuery({
    queryKey: ["preview", fixture.fixture.id],
    queryFn: () => fetchPreview({ data: { homeId: fixture.teams.home.id, awayId: fixture.teams.away.id, last: 5 } }),
    staleTime: 60 * 60_000, // Aumentado para 1h para mobile performance
    // Só busca a prévia na API quando o usuário abre o jogo — evita ~12 requisições por card.
    // Cards na lista usam as probabilidades persistidas da varredura (sem gastar API).
    enabled: !!isSelected && (market === "none" || !predictions.some(p => p.fixtureId === fixture.fixture.id)),
  });

  const pred = useMemo(() => {
    // Mescla predições da varredura atual e das persistidas
    const saved = predictions.find(p => p.fixtureId === fixture.fixture.id);
    const persisted = persistedPredictions.find(p => p.fixtureId === fixture.fixture.id);
    
    if (saved || persisted) {
      return { ...(persisted || {}), ...(saved || {}), ready: true } as any;
    }
    
    return data ? { ...computeOwnPrediction(data.home, data.away), ready: true } : null;
  }, [data, predictions, persistedPredictions, fixture.fixture.id]);

  if (!pred || !pred.ready) return null;

  // Renderiza múltiplos selos baseados nas probabilidades persistidas
  const activeBadges: { label: string; p: number; isBest?: boolean }[] = [];
  
  const addBadge = (id: string, label: string, p: number) => {
    // Se p < 0.5 e o mercado for BTTS YES, sugere BTTS NO com a diferença
    if (id === "btts_yes" && p < 0.5) {
      const pNo = 1 - p;
      if (pNo > 0.58) {
        activeBadges.push({ label: "BTTS NÃO", p: pNo, isBest: pred.bestMarket === "btts_no" });
      }
      return;
    }
    
    if (p > 0.58) { 
      activeBadges.push({ label, p, isBest: pred.bestMarket === id });
    }
  };

  if (market === "smart_ia") {
    const labels: Record<string, string> = {
      u15: "U1.5", o15: "O1.5", 
      btts_yes: "BTTS SIM", btts_no: "BTTS NÃO",
      corners_o95: "C9.5+", corners_u95: "C9.5-"
    };
    
    // Se tivermos topMarkets (nova versão), usamos eles, senão usamos o bestMarket (fallback)
    const itemsToShow = pred.topMarkets || (pred.bestMarket ? [{ id: pred.bestMarket, prob: pred.bestProb }] : []);
    
    itemsToShow.forEach((item: any, idx: number) => {
      let displayMarket = item.id;
      let displayProb = item.prob;
      let displayLabel = labels[displayMarket] || displayMarket.toUpperCase();

      if (displayMarket === "btts_yes" && displayProb < 0.5) {
        displayMarket = "btts_no";
        displayProb = 1 - displayProb;
        displayLabel = "BTTS NÃO";
      }

      if (displayProb > 0.45) {
        activeBadges.push({ 
          label: displayLabel, 
          p: displayProb,
          isBest: idx === 0 // O primeiro é o principal "IA INDICADO"
        });
      }
    });
  } else if (market !== "none") {
    // Show only the selected market badge
    let val = market === "u15" ? pred.pUnder15 :
              market === "o15" ? pred.pOver15 :
              market === "u25" ? pred.pUnder25 :
              market === "o25" ? pred.pOver25 :
              market === "btts_yes" ? pred.pBTTS :
              market === "btts_no" ? pred.pNoBTTS :
              market === "corners_u95" ? 1 - pred.pCornersOver95 :
              market === "corners_o95" ? pred.pCornersOver95 : 0;
    
    let displayLabel = market as string;
    if (market === "btts_yes" && val < 0.5) {
      val = 1 - val;
      displayLabel = "BTTS NÃO";
    } else {
      const labels: Record<string, string> = {
        u15: "U1.5", o15: "O1.5", u25: "U2.5", o25: "O2.5",
        btts_yes: "BTTS SIM", btts_no: "BTTS NÃO",
        corners_o95: "C9.5+", corners_u95: "C9.5-"
      };
      displayLabel = labels[market as any] || "PROB";
    }
    
    if (val > 0.3) {
      activeBadges.push({ label: displayLabel, p: val });
    }
  } else {
    // None selected, but scan active - show everything high confidence
    addBadge("u15", "U1.5", pred.pUnder15);
    addBadge("o15", "O1.5", pred.pOver15);
    addBadge("btts_yes", "BTTS SIM", pred.pBTTS);
    addBadge("corners_o95", "C9.5+", pred.pCornersOver95);
    addBadge("corners_u95", "C9.5-", 1 - pred.pCornersOver95);
  }

  if (activeBadges.length === 0) return null;

  const isBetanoSpecial = pinned["especiais-betano"].includes(fixture.fixture.id);

  return (
    <div className="absolute top-16 right-0 flex flex-col items-end gap-1.5 z-20 pointer-events-none">
      {isBetanoSpecial && (
        <div className="backdrop-blur-md bg-orange-500 text-white border-l border-b border-t border-orange-600 px-3 py-1 rounded-l-xl flex items-center gap-2 shadow-[0_0_20px_rgba(251,146,60,0.4)] animate-pulse">
          <div className="flex flex-col items-end leading-none">
            <span className="text-[7px] font-black uppercase tracking-[0.15em] text-white/80">Estratégia Elite</span>
            <span className="text-[10px] font-black mt-0.5">BETANO SPECIAL</span>
          </div>
          <div className="w-6 h-6 rounded-lg bg-white/20 flex items-center justify-center">
            <Star className="w-3.5 h-3.5 fill-current" />
          </div>
        </div>
      )}
      {activeBadges.map((badge, idx) => (
        <div 
          key={idx}
          className={`backdrop-blur-md border-l border-b border-t px-3 py-1 rounded-l-xl flex items-center gap-2 shadow-2xl transition-all duration-300 transform group-hover:translate-x-0 translate-x-1 ${
            badge.isBest || isSelected 
              ? "bg-primary text-primary-foreground border-primary/50" 
              : "bg-black/60 border-white/10 text-primary"
          }`}
        >
          <div className="flex flex-col items-end leading-none">
            <span className={`text-[7px] font-black uppercase tracking-[0.15em] ${badge.isBest || isSelected ? "text-primary-foreground/70" : "text-primary/70"}`}>
              {badge.isBest ? "IA INDICADO • " : ""}{badge.label}
            </span>
            <span className={`text-[11px] font-black tabular mt-0.5 ${badge.isBest || isSelected ? "text-primary-foreground" : "text-white"}`}>{pctFmt(badge.p)}</span>
          </div>
          <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${badge.isBest || isSelected ? "bg-white/20" : "bg-primary/20"}`}>
            {badge.isBest ? <Sparkles className="w-3.5 h-3.5" /> : <BrainCircuit className="w-3.5 h-3.5" />}
          </div>
        </div>
      ))}
    </div>
  );

}



import { NotificationButton as SharedNotificationButton } from "@/lib/favorites";

function FavoriteButton({ fixtureId }: { fixtureId: number }) {
  return <SharedFavoriteButton fixtureId={fixtureId} />;
}

function NotificationButton({ fixtureId }: { fixtureId: number }) {
  return <SharedNotificationButton fixtureId={fixtureId} />;
}



/** Memo: o card só re-renderiza quando placar/status/tempo do jogo muda. */
export const MatchCard = memo(MatchCardBase, (a, b) =>
  a.fixture.fixture.id === b.fixture.fixture.id &&
  a.fixture.fixture.status.short === b.fixture.fixture.status.short &&
  a.fixture.fixture.status.elapsed === b.fixture.fixture.status.elapsed &&
  a.fixture.goals.home === b.fixture.goals.home &&
  a.fixture.goals.away === b.fixture.goals.away,
);
