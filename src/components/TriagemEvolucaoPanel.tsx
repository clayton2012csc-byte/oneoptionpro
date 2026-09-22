/**
 * Evolução Diária da Triagem — relatório em gráficos.
 * Mostra como a função está evoluindo dia a dia: assertividade,
 * volume de publicados e tendência por mercado.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, BarChart3, RefreshCw } from "lucide-react";
import { getTriagemEvolucao, runTriagemGrading } from "@/lib/triagem.functions";
import { TRIAGEM_LABEL, type TriagemMarket } from "@/lib/triagem-engine";

const AMBER = "#f59e0b";
const EMERALD = "#10b981";
const RED = "#f87171";
const SLATE = "#94a3b8";

const WINDOWS = [7, 15, 30, 60];

/** Meta de assertividade: a partir dela o mercado é considerado consistente. */
const TARGET_ACC = 0.7;

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function fmtDDMM(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function ma<T extends { accuracy: number }>(data: T[], k: number): Array<T & { ma7: number }> {
  return data.map((d, i) => {
    const from = Math.max(0, i - k + 1);
    const slice = data.slice(from, i + 1);
    const v = slice.reduce((a, b) => a + b.accuracy, 0) / slice.length;
    return { ...d, ma7: Math.round(v * 1000) / 1000 };
  });
}

/** Dia agregado exibido nos gráficos (já formatado para dd/mm e com a média móvel). */
type EvoDay = {
  date: string;
  analyzed: number;
  published: number;
  greens: number;
  reds: number;
  pending: number;
  accuracy: number;
  ma7: number;
  accPct: number;
};

/** Tooltip comum aos gráficos: mostra volume, verdes/vermelhos e assertividade do dia. */
function EvoTooltip({ active, payload }: { active?: boolean; payload?: unknown[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0] as { payload: EvoDay };
  const day = d.payload;
  return (
    <div className="rounded-xl border border-white/10 bg-black/85 px-3 py-2 text-[11px] shadow-xl">
      <div className="font-bold">{day.date}</div>
      <div className="text-muted-foreground">
        Publicados: {day.published} · Verdes {day.greens}G / Vermelhos {day.reds}R
      </div>
      <div className="text-emerald-400">Assertividade {day.accPct}%</div>
      <div className="text-amber-400">Média 7d {Math.round((day.ma7 ?? 0) * 100)}%</div>
    </div>
  );
}

export function TriagemEvolucaoPanel() {
  const fetchEvo = useServerFn(getTriagemEvolucao);
  const grade = useServerFn(runTriagemGrading);
  const qc = useQueryClient();
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["triagem", "evolucao", days],
    queryFn: () => fetchEvo({ data: { days } }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });
  const check = useMutation({
    mutationFn: () => grade({ data: undefined as never }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["triagem"] }),
  });

  const evo = q.data;
  const daily = ma(evo?.days ?? [], 7).map((d) => ({
    ...d,
    date: fmtDDMM(d.date),
    accPct: Math.round(d.accuracy * 100),
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Evolução diária
        </span>
        <div className="ml-auto inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] p-1">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => setDays(w)}
              className={`rounded-md px-2 py-1 text-[10px] font-bold transition ${
                days === w
                  ? "bg-primary/20 text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
        <button
          onClick={() => check.mutate()}
          disabled={check.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider transition hover:border-primary/40 disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${check.isPending ? "animate-spin" : ""}`} />
          {check.isPending ? "Conferindo…" : "Conferir agora"}
        </button>
        {check.data && (
          <span className="text-[10px] text-muted-foreground">
            {check.data.graded} palpite{check.data.graded === 1 ? "" : "s"} conferido
            {check.data.graded === 1 ? "" : "s"}
          </span>
        )}
      </div>


      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando evolução…</p>}
      {q.error && <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>}

      {!q.isLoading && evo && (
        <>
          {(() => {
            const first = daily[0];
            const last = daily[daily.length - 1];
            if (!first || !last || daily.length < 2) return null;
            const delta = last.accPct - first.accPct;
            const Icon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
            const tone =
              delta > 0
                ? "text-emerald-400"
                : delta < 0
                  ? "text-red-400"
                  : "text-muted-foreground";
            return (
              <div className="glass rounded-2xl border border-white/10 px-3 py-2.5 flex items-center gap-2">
                <Icon className={`w-4 h-4 shrink-0 ${tone}`} />
                <div className="text-[11px] text-muted-foreground">
                  <b>
                    Início {first.accPct}% → Fim {last.accPct}%
                  </b>
                  <span className={tone}> ({delta > 0 ? "+" : ""}{delta} pts)</span>
                  <span className="hidden md:inline"> no período de {daily.length} dias</span>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Jogos analisados
              </div>
              <div className="text-lg font-black tabular-nums">{evo.totalAnalyzed}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Mercados publicados
              </div>
              <div className="text-lg font-black tabular-nums">{evo.totalPublished}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Assertividade geral
              </div>
              <div className="text-lg font-black tabular-nums">{pct(evo.overallAccuracy ?? 0)}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
              <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">
                Verde / Vermelho
              </div>
              <div className="text-lg font-black tabular-nums">
                <span className="text-emerald-400">
                  {evo.days.reduce((a, d) => a + d.greens, 0)}G
                </span>
                {" · "}
                <span className="text-red-400">{evo.days.reduce((a, d) => a + d.reds, 0)}R</span>
              </div>
            </div>
          </div>

          {evo.days.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Sem avaliações registradas neste período. Rode{" "}
              <code>supabase/triagem-certificacao.sql</code> no banco e aguarde a varredura.
            </p>
          )}

          {evo.days.length > 0 && (
            <>
              <div className="glass rounded-2xl border border-white/10 p-3">
                <div className="mb-2 text-[11px] font-bold text-muted-foreground">
                  Assertividade diária % + média móvel 7 dias
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: SLATE, fontSize: 10 }} minTickGap={24} />
                      <YAxis
                        tick={{ fill: SLATE, fontSize: 10 }}
                        domain={[0, 1]}
                        tickFormatter={(v) => `${Math.round(v * 100)}%`}
                      />
                      <ReferenceLine
                        y={TARGET_ACC}
                        stroke={SLATE}
                        strokeDasharray="4 4"
                        strokeOpacity={0.7}
                        label={{ value: "meta 70%", position: "insideTopRight", fill: SLATE, fontSize: 10 }}
                      />
                      <Tooltip content={<EvoTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Area
                        type="monotone"
                        dataKey="accuracy"
                        name="Assertividade"
                        stroke={EMERALD}
                        fill={EMERALD}
                        fillOpacity={0.15}
                        strokeWidth={2}
                      />
                      <Line
                        type="monotone"
                        dataKey="ma7"
                        name="Média 7 dias"
                        stroke={AMBER}
                        strokeWidth={2}
                        dot={false}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="glass rounded-2xl border border-white/10 p-3">
                <div className="mb-2 text-[11px] font-bold text-muted-foreground">
                  Mercados publicados por dia (verde · vermelho)
                </div>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
                      <CartesianGrid stroke="rgba(255,255,255,0.06)" strokeDasharray="3 3" />
                      <XAxis dataKey="date" tick={{ fill: SLATE, fontSize: 10 }} minTickGap={24} />
                      <YAxis tick={{ fill: SLATE, fontSize: 10 }} allowDecimals={false} />
                      <Tooltip
                        content={<EvoTooltip />}
                      />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar
                        dataKey="greens"
                        name="Verdes"
                        stackId="pub"
                        fill={EMERALD}
                        radius={[0, 0, 2, 2]}
                      />
                      <Bar
                        dataKey="reds"
                        name="Vermelhos"
                        stackId="pub"
                        fill={RED}
                        radius={[2, 2, 0, 0]}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {evo.markets.map((m) => {
                  const withVol = m.trend.filter((t) => t.published > 0);
                  const first = withVol[0];
                  const last = withVol[withVol.length - 1];
                  const delta = first && last ? last.accuracy - first.accuracy : 0;
                  const TrendIcon =
                    delta > 0.01 ? TrendingUp : delta < -0.01 ? TrendingDown : Minus;
                  const trendTone =
                    delta > 0.01
                      ? "text-emerald-400"
                      : delta < -0.01
                        ? "text-red-400"
                        : "text-muted-foreground";
                  return (
                    <div key={m.market} className="glass rounded-2xl border border-white/10 p-3">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] font-black truncate">
                          {TRIAGEM_LABEL[m.market as TriagemMarket] ?? m.market}
                        </span>
                        <TrendIcon className={`w-3.5 h-3.5 ml-auto shrink-0 ${trendTone}`} />
                      </div>
                      <div className="text-[10px] text-muted-foreground tabular-nums">
                        {m.volume ? pct(m.accuracy) : "—"} de assertividade · {m.volume} publicado
                        {m.volume === 1 ? "" : "s"} · {m.greens}G/{m.reds}R
                      </div>
                      <div className="mt-2 h-12">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart
                            data={m.trend}
                            margin={{ top: 2, right: 2, bottom: 0, left: 2 }}
                          >
                            <Line
                              type="monotone"
                              dataKey="accuracy"
                              stroke={AMBER}
                              strokeWidth={1.5}
                              dot={false}
                              isAnimationActive={false}
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
