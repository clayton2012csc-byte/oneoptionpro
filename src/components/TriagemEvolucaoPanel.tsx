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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { getTriagemEvolucao } from "@/lib/triagem.functions";
import { TRIAGEM_LABEL, type TriagemMarket } from "@/lib/triagem-engine";

const AMBER = "#f59e0b";
const EMERALD = "#10b981";
const RED = "#f87171";
const SLATE = "#94a3b8";

const WINDOWS = [7, 15, 30, 60];

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function ma<T extends { accuracy: number }>(data: T[], k: number): Array<T & { ma7: number }> {
  return data.map((d, i) => {
    const from = Math.max(0, i - k + 1);
    const slice = data.slice(from, i + 1);
    const v = slice.reduce((a, b) => a + b.accuracy, 0) / slice.length;
    return { ...d, ma7: Math.round(v * 1000) / 1000 };
  });
}

export function TriagemEvolucaoPanel() {
  const fetchEvo = useServerFn(getTriagemEvolucao);
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["triagem", "evolucao", days],
    queryFn: () => fetchEvo({ data: { days } }),
    staleTime: 120_000,
    refetchInterval: 300_000,
  });

  const evo = q.data;
  const daily = ma(evo?.days ?? [], 7).map((d) => ({
    ...d,
    date: d.date.slice(5),
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
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Carregando evolução…</p>}
      {q.error && <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>}

      {!q.isLoading && evo && (
        <>
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
                      <Tooltip
                        formatter={(v) => [`${Math.round((v as number) * 100)}%`, "assertividade"]}
                        contentStyle={{
                          background: "rgba(0,0,0,0.85)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 12,
                          fontSize: 11,
                        }}
                      />
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
                        formatter={(v, n) => [
                          String(v),
                          n === "greens" ? "verdes" : n === "reds" ? "vermelhos" : String(n),
                        ]}
                        contentStyle={{
                          background: "rgba(0,0,0,0.85)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          borderRadius: 12,
                          fontSize: 11,
                        }}
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
