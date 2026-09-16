import { Link } from "@tanstack/react-router";
import { useRef } from "react";
import { Trophy, Star, Flag, Globe2, ChevronUp, ChevronDown } from "lucide-react";
import { useSelectedFixture } from "@/lib/selected-fixture";
import { useFavorites, toggleFavorite } from "@/lib/favorites";
import { MatchDetailPanel } from "./MatchDetailPanel";

const POPULAR = [
  { id: 71, name: "Brasileirão Série A", country: "Brasil", icon: "🇧🇷" },
  { id: 72, name: "Brasileirão Série B", country: "Brasil", icon: "🇧🇷" },
  { id: 73, name: "Copa do Brasil", country: "Brasil", icon: "🇧🇷" },
  { id: 13, name: "Copa Libertadores", country: "América do Sul", icon: "🏆" },
  { id: 11, name: "Sul-Americana", country: "América do Sul", icon: "🏆" },
  { id: 2, name: "Champions League", country: "Europa", icon: "⭐" },
  { id: 3, name: "Europa League", country: "Europa", icon: "⭐" },
  { id: 39, name: "Premier League", country: "Inglaterra", icon: "🏴󠁧󠁢󠁥󠁮󠁧󠁿" },
  { id: 140, name: "La Liga", country: "Espanha", icon: "🇪🇸" },
  { id: 135, name: "Serie A", country: "Itália", icon: "🇮🇹" },
  { id: 78, name: "Bundesliga", country: "Alemanha", icon: "🇩🇪" },
  { id: 61, name: "Ligue 1", country: "França", icon: "🇫🇷" },
  { id: 253, name: "MLS", country: "EUA", icon: "🇺🇸" },
  { id: 128, name: "Liga Argentina", country: "Argentina", icon: "🇦🇷" },
];

export function LeagueList({ onNavigate }: { onNavigate?: () => void } = {}) {
  const favorites = useFavorites();
  return (
    <div className="rounded-xl glass p-3">
      <div className="flex items-center gap-2 px-2 py-1.5 mb-1">
        <Trophy className="w-4 h-4 text-primary" />
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Principais Ligas
        </h2>
      </div>
      <nav className="space-y-0.5">
        {POPULAR.map((l) => {
          const active = favorites.includes(l.id);
          return (
            <Link
              key={l.id}
              to="/liga/$leagueId"
              params={{ leagueId: String(l.id) }}
              onClick={onNavigate}
              className="flex items-center gap-2.5 px-2 py-2.5 rounded-lg text-sm hover:bg-accent/70 transition group"
            >
              <span className="w-6 h-6 rounded-md bg-white/5 flex items-center justify-center text-xs shrink-0">
                {l.icon}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-semibold truncate">{l.name}</span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {l.country}
                </span>
              </span>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  toggleFavorite(l.id);
                }}
                className={`w-7 h-7 flex items-center justify-center rounded-full transition ${
                  active
                    ? "text-primary scale-110"
                    : "text-muted-foreground/40 group-hover:text-primary/60"
                }`}
              >
                <Star className={`w-3.5 h-3.5 ${active ? "fill-current" : ""}`} />
              </button>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

export function LeagueSidebar() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const nudge = (dir: -1 | 1) =>
    scrollRef.current?.scrollBy({ top: dir * 200, behavior: "smooth" });
  return (
    <aside className="hidden lg:block w-64 shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] relative group/side">
      <button
        type="button"
        aria-label="Rolar para cima"
        onClick={() => nudge(-1)}
        className="absolute top-1 left-1/2 -translate-x-1/2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center opacity-0 group-hover/side:opacity-100 hover:bg-black/80 transition"
      >
        <ChevronUp className="w-4 h-4 text-white" />
      </button>
      <button
        type="button"
        aria-label="Rolar para baixo"
        onClick={() => nudge(1)}
        className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center opacity-0 group-hover/side:opacity-100 hover:bg-black/80 transition"
      >
        <ChevronDown className="w-4 h-4 text-white" />
      </button>
      <div
        ref={scrollRef}
        className="max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-none scroll-smooth"
      >
        <LeagueList />
      </div>
    </aside>
  );
}

export function RightPanel() {
  const selected = useSelectedFixture();
  const scrollRef = useRef<HTMLDivElement>(null);
  const nudge = (dir: -1 | 1) =>
    scrollRef.current?.scrollBy({ top: dir * 240, behavior: "smooth" });
  return (
    <aside className="hidden xl:block w-80 shrink-0 sticky top-4 self-start max-h-[calc(100vh-6rem)] relative group/rp">
      <button
        type="button"
        aria-label="Rolar para cima"
        onClick={() => nudge(-1)}
        className="absolute top-1 left-1/2 -translate-x-1/2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center opacity-0 group-hover/rp:opacity-100 hover:bg-black/80 transition"
      >
        <ChevronUp className="w-4 h-4 text-white" />
      </button>
      <button
        type="button"
        aria-label="Rolar para baixo"
        onClick={() => nudge(1)}
        className="absolute bottom-1 left-1/2 -translate-x-1/2 z-10 w-7 h-7 rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center opacity-0 group-hover/rp:opacity-100 hover:bg-black/80 transition"
      >
        <ChevronDown className="w-4 h-4 text-white" />
      </button>
      <div
        ref={scrollRef}
        className="max-h-[calc(100vh-6rem)] overflow-y-auto scrollbar-none scroll-smooth space-y-3"
      >
        {selected ? (
          <MatchDetailPanel fixtureId={selected} embedded />
        ) : (
          <>
            <div className="rounded-xl glass p-4 border-primary/20">
              <div className="flex items-center gap-2 mb-2">
                <Flag className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Selecione um jogo</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Clique em uma partida ao lado para ver detalhes, escalações, previsão IA,
                estatísticas, classificações, CD, dados e probabilidades.
              </p>
            </div>

            <div className="rounded-xl glass p-4">
              <div className="flex items-center gap-2 mb-3">
                <Globe2 className="w-4 h-4 text-primary" />
                <h3 className="text-xs font-bold uppercase tracking-wider">Atalhos</h3>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link
                  to="/live"
                  className="rounded-lg bg-destructive/15 border border-destructive/30 p-2.5 text-center hover:bg-destructive/25 transition"
                >
                  <div className="text-[10px] font-bold text-destructive uppercase">Ao Vivo</div>
                </Link>
                <Link
                  to="/proximo"
                  className="rounded-lg bg-white/5 border border-white/10 p-2.5 text-center hover:bg-white/10 transition"
                >
                  <div className="text-[10px] font-bold uppercase">Próximo</div>
                </Link>
                <Link
                  to="/placar"
                  className="rounded-lg bg-white/5 border border-white/10 p-2.5 text-center hover:bg-white/10 transition"
                >
                  <div className="text-[10px] font-bold uppercase">Placar</div>
                </Link>
                <Link
                  to="/seguinte"
                  className="rounded-lg bg-primary/15 border border-primary/30 p-2.5 text-center hover:bg-primary/25 transition"
                >
                  <div className="text-[10px] font-bold text-primary uppercase">Terminado</div>
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
