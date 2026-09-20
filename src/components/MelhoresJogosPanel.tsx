/**
 * Melhores Jogos de Hoje — ranking dos palpites já salvos em `auto_tickets`
 * (próximas 24h). Zero chamadas à API-Football: olha apenas o que a IA já
 * gravou no banco (bilhetes automáticos), ranqueia por score dos 5 Pilares e
 * probabilidade, e adiciona ao bilhete em 1 toque via drawer existente.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Flame,
  Loader2,
  RefreshCw,
  AlertTriangle,
  Plus,
  Check,
  ChevronDown,
  Ticket,
} from "lucide-react";
import { listBestTickets, type BestTicketRow } from "@/lib/auto-tickets.functions";
import { makeSlipId, useBetSlip } from "@/lib/bet-slip";
import { isRiskyMarket, marketRisk, getHideRisky, setHideRisky } from "@/lib/market-risk";

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type HorizonId = "24h" | "hoje" | "3h";
const HORIZONS: readonly { id: HorizonId; label: string }[] = [
  { id: "24h", label: "Próximas 24h" },
  { id: "hoje", label: "Hoje" },
  { id: "3h", label: "Próximas 3h" },
];

function isToday(iso: string) {
  const d = new Date(iso);
  const n = new Date();
  return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
}

function RiskBadge({ market }: { market: string }) {
  const acc = marketRisk(market);
  if (acc == null || !isRiskyMarket(market)) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide bg-red-500/15 text-red-300 border border-red-500/30">
      <AlertTriangle className="h-3 w-3" />
      Alta variância · {pct(acc)} histórico
    </span>
  );
}

function GameCard({ row, hideRisky }: { row: BestTicketRow; hideRisky: boolean }) {
  const items = useBetSlip((s) => s.items);
  const toggleItem = useBetSlip((s) => s.toggleItem);
  const addItem = useBetSlip((s) => s.addItem);
  const setOpenDrawer = useBetSlip((s) => s.setOpen);
  const [open, setOpen] = useState(false);

  const kickoff = new Date(row.kickoff);
  const picks = (row.picks ?? []).filter((p) => !(hideRisky && isRiskyMarket(p.market)));
  const shown = open ? picks : picks.slice(0, 3);

  const inSlip = (market: string, selection: string) =>
    items.some((i) => i.id === makeSlipId(row.fixture_id, market, selection));

  const addPick = (p: BestTicketRow["picks"][number]) => {
    toggleItem({
      id: makeSlipId(row.fixture_id, p.market, p.selection),
      fixtureId: row.fixture_id,
      home: row.home,
      away: row.away,
      league: row.league ?? undefined,
      time: row.kickoff,
      market: p.market,
      selection: p.selection,
      prob: p.prob,
      odd: p.odd,
      type: "ia",
    });
    setOpenDrawer(true);
  };

  /** Monta o bilhete do jogo com os 3 melhores picks (rejeita Placar Exato Seco). */
  const addGame = () => {
    const cand = picks
      .filter((p) => p.market !== "Placar Exato Seco")
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.prob ?? 0) - (a.prob ?? 0))
      .slice(0, 3);
    for (const p of cand) {
      if (inSlip(p.market, p.selection)) continue;
      addItem({
        id: makeSlipId(row.fixture_id, p.market, p.selection),
        fixtureId: row.fixture_id,
        home: row.home,
        away: row.away,
        league: row.league ?? undefined,
        time: row.kickoff,
        market: p.market,
        selection: p.selection,
        prob: p.prob,
        odd: p.odd,
        type: "ia",
      });
    }
    setOpenDrawer(true);
  };

  return (
    <div className="rounded-2xl border border-border/60 bg-card/70 overflow-hidden">
      <div className="flex items-start gap-3 px-3 py-3">
        <div className="flex -space-x-2 shrink-0">
          {row.home_logo && <img src={row.home_logo} alt={row.home} className="h-7 w-7 rounded-full bg-background/80" loading="lazy" />}
          {row.away_logo && <img src={row.away_logo} alt={row.away} className="h-7 w-7 rounded-full bg-background/80" loading="lazy" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold truncate">{row.home} <span className="text-muted-foreground">x</span> {row.away}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {row.league} · {hora(row.kickoff)}
          </div>
          {row.meta?.headline && (
            <div className="mt-1 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-2 py-1 text-[10px] text-emerald-200/90">
              <span className="font-black uppercase tracking-wide text-emerald-400 mr-1">Leitura:</span>
              {row.meta.headline}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1">
            <Flame className="h-3 w-3 text-emerald-400" />
            <span className="text-[11px] font-black text-emerald-300 tabular-nums">
              {row.topScore > 0 ? row.topScore.toFixed(0) : "—"}
            </span>
          </div>
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-black text-sky-300 tabular-nums">
            {row.topProb > 0 ? pct(row.topProb) : "—"}
          </div>
        </div>
      </div>

      <div className="px-3 pb-2 -mt-1 flex flex-wrap items-center gap-2">
        <button
          onClick={addGame}
          className="inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-primary transition-colors hover:bg-primary/20"
        >
          <Ticket className="h-3.5 w-3.5" />
          Montar bilhete do jogo
        </button>
        {picks.length > 3 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
          >
            {open ? "Mostrar menos" : `Ver ${picks.length} mercados`}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {!picks.some((p) => p.market === "Placar Exato Seco") && (
        <div className="px-3 pb-2">
          <span className="inline-flex items-start gap-1 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2 py-1 text-[10px] font-bold text-sky-200">
            <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
            Placar Exato omitido: probabilidade inferior ao limiar de segurança (14%).
          </span>
        </div>
      )}

      <div className="border-t border-border/50 divide-y divide-border/40">
        {shown.map((p, i) => {
          const added = inSlip(p.market, p.selection);
          return (
            <div key={`${p.market}-${i}`} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{p.market}</span>
                  <RiskBadge market={p.market} />
                  {p.market === "Placar Exato Seco" && (
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide bg-amber-500/15 text-amber-300 border border-amber-500/30">
                      <AlertTriangle className="h-3 w-3" />
                      Alta volatilidade · odd elevada · {pct(p.prob)}
                    </span>
                  )}
                </div>
                <div className="text-[12px] font-semibold truncate">{p.selection}</div>
                {p.score != null && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide bg-emerald-500/15 text-emerald-300">
                      Score {Math.round(p.score)}
                    </span>
                    {p.pillarMin != null && (
                      <span className="text-[9px] text-muted-foreground">mín. {Math.round(p.pillarMin)}</span>
                    )}
                  </div>
                )}
                {p.market === "Placar Exato Seco" && (
                  <div className="mt-0.5 text-[10px] font-bold text-amber-300/90">
                    Odd mínima recomendada: @6.00
                    {p.odd < 6 ? " · odd atual abaixo do mínimo, evitar" : ""}
                  </div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-[12px] font-black tabular-nums">{pct(p.prob)}</div>
                <div className="text-[10px] text-muted-foreground tabular-nums">@{p.odd?.toFixed(2)}</div>
              </div>
              <button
                onClick={() => addPick(p)}
                aria-label={added ? `Remover ${p.selection} do bilhete` : `Adicionar ${p.selection} ao bilhete`}
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition ${
                  added
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                    : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20"
                }`}
              >
                {added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MelhoresJogosPanel() {
  const load = useServerFn(listBestTickets);
  const [horizon, setHorizon] = useState<HorizonId>("24h");
  const [hideRisky, setHide] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => setHide(getHideRisky()), []);
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const toggleRisky = () => {
    setHide((v) => {
      setHideRisky(!v);
      return !v;
    });
  };

  const q = useQuery({
    queryKey: ["melhores-jogos"],
    queryFn: () => load(),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const rows = q.data?.rows ?? [];
  const filtered = useMemo(() => {
    if (horizon === "hoje") return rows.filter((r) => isToday(r.kickoff));
    if (horizon === "3h") return rows.filter((r) => new Date(r.kickoff).getTime() <= nowMs + 3 * 60 * 60 * 1000);
    return rows;
  }, [rows, horizon, nowMs]);

  const totalPicks = filtered.reduce((s, r) => s + (r.picks?.length ?? 0), 0);
  const bestScore = filtered.reduce((s, r) => Math.max(s, r.topScore), 0);
  const scarce = rows.length > 0 && rows.length <= 5;

  return (
    <div className="px-3 pb-10 space-y-3">
      <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/10 to-transparent p-4">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          <h2 className="text-[15px] font-black tracking-tight">Melhores Jogos de Hoje</h2>
          {(q.isFetching) && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
          <button
            onClick={() => void q.refetch()}
            aria-label="Atualizar"
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-primary transition-colors hover:bg-primary/20"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar
          </button>
        </div>
        <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
          Os melhores jogos para apostar agora a partir dos palpites <b>já salvos</b> nos bilhetes
          automáticos. O ranking usa o score dos 5 Pilares e a probabilidade — nada é gerado na
          hora, então <b>não gasta a cota da API</b>.
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {HORIZONS.map((h) => (
              <button
                key={h.id}
                onClick={() => setHorizon(h.id)}
                className={`rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-wide transition ${
                  horizon === h.id
                    ? "border-primary/50 bg-primary/15 text-primary"
                    : "border-border/60 bg-background/40 text-muted-foreground"
                }`}
              >
                {h.label}
              </button>
            ))}
          </div>
          <button
            onClick={toggleRisky}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[10px] font-black uppercase tracking-wide ${
              hideRisky
                ? "border-red-500/40 bg-red-500/10 text-red-300"
                : "border-border/60 bg-background/40 text-muted-foreground"
            }`}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {hideRisky ? "Mercados < 20% ocultos" : "Ocultar mercados < 20%"}
          </button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="rounded-xl bg-background/40 p-2 text-center">
            <div className="text-[16px] font-black">{filtered.length}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Jogos</div>
          </div>
          <div className="rounded-xl bg-background/40 p-2 text-center">
            <div className="text-[16px] font-black">{totalPicks}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Palpites</div>
          </div>
          <div className="rounded-xl bg-background/40 p-2 text-center">
            <div className="text-[16px] font-black text-emerald-400">{bestScore > 0 ? bestScore.toFixed(0) : "—"}</div>
            <div className="text-[10px] text-muted-foreground uppercase">Maior score</div>
          </div>
        </div>
      </div>

      {scarce && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-300" />
            <p className="text-[11px] text-amber-200/90 leading-relaxed">
              <b className="uppercase tracking-wide">Poucos jogos pendentes agora.</b> A varredura
              rodou com a cota da API esgotada, então estes são os únicos palpites salvos para as
              próximas 24h. Eles são reais — aproveite sem gastar cota. Quando a cota voltar, o robô
              completa a carga automaticamente.
            </p>
          </div>
        </div>
      )}

      {q.isLoading && <div className="text-[12px] text-muted-foreground px-1">Carregando melhores jogos…</div>}
      {!q.isLoading && filtered.length === 0 && (
        <div className="rounded-2xl border border-border/60 bg-card/70 p-6 text-center">
          <p className="text-[13px] font-bold">
            Nenhum jogo pendente com palpites neste horizonte.
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            Os bilhetes automáticos só existem para jogos que a IA conseguiu analisar. Com a cota
            da API esgotada (auto-bloqueio 80%), não há memória de análise para estes horários.
            Se a cota voltar, veja o painel <b>Minha API</b> e desligue o bloqueio para o robô
            voltar a salvar palpites.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {filtered.map((r) => (
          <GameCard key={r.id} row={r} hideRisky={hideRisky} />
        ))}
      </div>
    </div>
  );
}