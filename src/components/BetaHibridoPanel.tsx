import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, RotateCw, Copy, Check, Layers } from "lucide-react";
import { getBetaHibrido } from "@/lib/beta-hibrido.functions";
import { betaSystemMath, betaText, BETA_STAKE, type BetaSnapshot } from "@/lib/beta-hibrido";
import { FixtureLink } from "@/components/FixtureLink";

const hora = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })
    : "--:--";

/** Gerador Híbrido automático da aba Beta — lê só a Triagem (zero API). */
export function BetaHibridoPanel() {
  const fetchBeta = useServerFn(getBetaHibrido);
  const [copied, setCopied] = useState(false);
  const q = useQuery<BetaSnapshot>({
    queryKey: ["beta-hibrido"],
    queryFn: () => fetchBeta(),
    staleTime: 10 * 60_000,
  });

  const snap = q.data;
  const games = snap?.games ?? [];
  const math = useMemo(() => betaSystemMath(games, snap?.stake ?? BETA_STAKE), [games, snap?.stake]);

  const copy = async () => {
    if (!snap) return;
    await navigator.clipboard.writeText(betaText(snap));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/10">
        <Layers className="w-4 h-4 text-cyan-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-black uppercase tracking-wider text-cyan-400">Gerador Híbrido · Sistema 3/4</div>
          <div className="text-[11px] text-muted-foreground font-semibold">
            Varredura instantânea na Triagem (Under 1.5 · Ambas Não · Casa Vence, nota ≥ 75) — sem gastar API.
            {snap ? ` ${snap.scanned} jogo(s) elegíveis hoje.` : ""}
          </div>
        </div>
        <button
          onClick={() => q.refetch()}
          title="Refazer varredura"
          className="w-7 h-7 flex items-center justify-center text-muted-foreground hover:text-foreground"
        >
          {q.isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCw className="w-4 h-4" />}
        </button>
        {games.length > 0 && (
          <button
            onClick={copy}
            className="text-[11px] font-bold px-3 py-1.5 rounded-full bg-cyan-500 text-black flex items-center gap-1"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            Copiar colinha
          </button>
        )}
      </div>

      {q.isLoading && <div className="px-3 py-6 text-center text-xs text-muted-foreground">Lendo a base da Triagem…</div>}

      {!q.isLoading && games.length < 4 && (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          Ainda não há 4 jogos do perfil defensivo com nota ≥ 75 para hoje. Assim que a Triagem publicar, o fechamento aparece aqui sozinho.
        </div>
      )}

      {games.length >= 4 && (
        <div className="p-3 space-y-3">
          {(["superior", "inferior"] as const).map((block) => (
            <div key={block} className="space-y-2">
              <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
                {block === "superior" ? "Par superior · empate + vitória seca" : "Par inferior · vitória controlada + especial Betano"}
              </div>
              {games
                .map((g, i) => ({ g, i }))
                .filter(({ g }) => g.block === block)
                .map(({ g, i }) => (
                  <div key={g.fixtureId} className="rounded-xl border border-white/10 bg-black/20 p-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-[10px] font-black px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">JOGO {i + 1}</span>
                      <FixtureLink fixtureId={g.fixtureId} className="text-sm font-bold text-white truncate">
                        {g.home} <span className="text-muted-foreground">x</span> {g.away}
                      </FixtureLink>
                      <span className="ml-auto text-[10px] text-muted-foreground font-semibold shrink-0">
                        {hora(g.kickoff)} · nota {Math.round(g.score)}
                      </span>
                    </div>
                    <div className="grid gap-1.5 sm:grid-cols-3">
                      {g.options.map((o) => (
                        <div key={o.n} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                          <div className="text-[10px] font-black uppercase text-cyan-300">Opção {o.n} · {o.title}</div>
                          <div className="text-[12px] font-bold text-white leading-snug">{o.selection}</div>
                          <div className="text-[10px] text-muted-foreground font-semibold mt-0.5">
                            odd estimada {o.odd.toFixed(2)} · {Math.round(o.prob * 100)}%
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          ))}

          <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/[0.06] p-3">
            <div className="text-[10px] font-black uppercase tracking-widest text-cyan-300 mb-1.5">Sistema 3/4 da Betano</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div>
                <div className="text-base font-black text-white">{math.combos}</div>
                <div className="text-[10px] text-muted-foreground font-semibold">combinações</div>
              </div>
              <div>
                <div className="text-base font-black text-white">R$ {math.cost.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground font-semibold">custo (R$ {(snap?.stake ?? BETA_STAKE).toFixed(2)}/aposta)</div>
              </div>
              <div>
                <div className="text-base font-black text-emerald-400">R$ {math.return3.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground font-semibold">3 acertos</div>
              </div>
              <div>
                <div className="text-base font-black text-emerald-400">R$ {math.return4.toFixed(2)}</div>
                <div className="text-[10px] text-muted-foreground font-semibold">4 acertos</div>
              </div>
            </div>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {math.triples.map((t) => (
                <div key={t.skipped} className="text-[11px] font-semibold text-muted-foreground">
                  Trio sem o jogo {t.skipped + 1}: <span className="text-white">{t.games.map((i) => i + 1).join(" + ")}</span> · odd {t.odd.toFixed(2)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
