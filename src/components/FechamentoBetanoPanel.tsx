/**
 * Fechamento Betano 3/4 — os 4 jogos do dia com 3 opções de cobertura cada,
 * calculadora do sistema e o bilhete pronto para copiar.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import {
  Copy,
  Check,
  Loader2,
  RefreshCw,
  Layers,
  ShieldCheck,
  Save,
  CalendarClock,
} from "lucide-react";
import {
  getFechamentoBetano,
  rebuildFechamentoBetano,
} from "@/lib/fechamento-betano.functions";
import {
  closureText,
  systemMath,
  type CoverageGame,
  type FechamentoSnapshot,
} from "@/lib/fechamento-betano";
import { saveFechamento } from "@/lib/fechamentos";

const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GameCard({ g, index }: { g: CoverageGame; index: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur">
      <div className="flex items-center gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/15 text-xs font-bold text-primary">
          {index + 1}
        </span>
        {g.homeLogo ? <img src={g.homeLogo} alt="" className="h-6 w-6 object-contain" /> : null}
        <span className="truncate text-sm font-semibold">{g.home}</span>
        <span className="text-xs text-muted-foreground">x</span>
        <span className="truncate text-sm font-semibold">{g.away}</span>
        {g.awayLogo ? <img src={g.awayLogo} alt="" className="h-6 w-6 object-contain" /> : null}
        <span className="ml-auto rounded-full bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
          nota {g.score}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5" />
        {hora(g.kickoff)}
        {g.league ? <span>· {g.league}</span> : null}
        <span className="rounded-full border border-primary/30 px-2 py-0.5 text-primary">
          {g.profileLabel}
        </span>
      </div>

      <div className="mt-3 space-y-2">
        {g.options.map((o) => (
          <div
            key={o.n}
            className={`rounded-xl border p-3 ${
              o.protection ? "border-emerald-500/30 bg-emerald-500/5" : "border-border/50 bg-muted/20"
            }`}
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Opção {o.n}
              </span>
              <span className="text-xs font-semibold">{o.title}</span>
              <span className="ml-auto rounded-md bg-primary/15 px-2 py-0.5 text-xs font-bold text-primary">
                @ {o.odd.toFixed(2)}
              </span>
            </div>
            <div className="mt-1 text-sm font-medium">{o.selection}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">{o.reason}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FechamentoBetanoPanel() {
  const load = useServerFn(getFechamentoBetano);
  const rebuild = useServerFn(rebuildFechamentoBetano);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const q = useQuery<FechamentoSnapshot>({
    queryKey: ["fechamento-betano"],
    queryFn: () => load({}),
    staleTime: 10 * 60 * 1000,
  });

  const snap = q.data;
  const games = snap?.games ?? [];
  const math = systemMath(games, snap?.stake ?? 0.5);

  const onCopy = async () => {
    if (!snap) return;
    await navigator.clipboard.writeText(closureText(snap));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onSave = async () => {
    if (!snap?.games.length) return;
    setSaving(true);
    try {
      await saveFechamento({
        name: `Fechamento Betano 3/4 — ${snap.day}`,
        target_date: snap.day,
        games: snap.games.map((g) => ({
          id: g.fixtureId,
          home: g.home,
          away: g.away,
          league: g.league ?? undefined,
        })),
        tickets: snap.games.flatMap((g, i) =>
          g.options.map((o) => ({
            n: i + 1,
            type: g.profile,
            label: `${g.home} x ${g.away} — Opção ${o.n}`,
            detail: `${o.title}: ${o.selection} @ ${o.odd.toFixed(2)}`,
            conf: Math.round(o.prob * 100),
          })),
        ),
        summary: { system: "3/4", ...math },
      });
      setSaved("Fechamento salvo.");
    } catch (e) {
      setSaved((e as Error).message);
    } finally {
      setSaving(false);
      setTimeout(() => setSaved(null), 4000);
    }
  };

  const onRebuild = async () => {
    setBusy(true);
    try {
      await rebuild({});
      await q.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold">Fechamento Betano — Sistema 3/4</h2>
          <button
            onClick={onRebuild}
            disabled={busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-xs hover:bg-muted/40 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Remontar
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Os 4 melhores jogos do dia com 3 opções de cobertura cada. Se a leitura do jogo estiver
          certa, uma das 3 opções bate. Com 3 acertos em 4 jogos o investimento volta; com 4, o lucro
          é máximo.
        </p>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Montando o fechamento do dia...
        </div>
      ) : !games.length ? (
        <div className="rounded-2xl border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
          Ainda não há 4 jogos que atendam ao método hoje. Toque em Remontar depois que o robô rodar
          a próxima varredura.
        </div>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {games.map((g, i) => (
              <GameCard key={g.fixtureId} g={g} index={i} />
            ))}
          </div>

          <div className="rounded-2xl border border-border/60 bg-card/60 p-4 backdrop-blur">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-emerald-400" />
              <h3 className="text-sm font-bold">Desdobramento na Betano</h3>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                <div className="font-semibold">Sistema 3/4</div>
                <div className="text-muted-foreground">
                  {math.combos34} combinações · {brl(snap?.stake ?? 0.5)} cada
                </div>
                <div className="mt-1 text-sm font-bold text-primary">Custo {brl(math.cost34)}</div>
              </div>
              <div className="rounded-xl border border-border/50 bg-muted/20 p-3">
                <div className="font-semibold">Quádrupla seca (4/4)</div>
                <div className="text-muted-foreground">
                  {math.combos44} combinações · {brl(snap?.stake ?? 0.5)} cada
                </div>
                <div className="mt-1 text-sm font-bold">Custo {brl(math.cost44)}</div>
              </div>
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
                <div className="font-semibold">Acertando 3 de 4</div>
                <div className="mt-1 text-sm font-bold text-emerald-400">{brl(math.return3)}</div>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
                <div className="font-semibold">Acertando os 4</div>
                <div className="mt-1 text-sm font-bold text-primary">{brl(math.return4)}</div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Retorno estimado pela menor odd de cada jogo — se a opção que bater for a de odd maior,
              o retorno sobe.
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                onClick={onCopy}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar estrutura do fechamento"}
              </button>
              <button
                onClick={onSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 px-3 py-2 text-xs font-semibold hover:bg-muted/40 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Salvar fechamento
              </button>
              {saved ? <span className="self-center text-xs text-muted-foreground">{saved}</span> : null}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
