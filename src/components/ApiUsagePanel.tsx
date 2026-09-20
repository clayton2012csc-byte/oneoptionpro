import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  X,
  Zap,
  CheckCircle2,
  AlertTriangle,
  Power,
  PowerOff,
  RefreshCw,
  Shield,
  ShieldOff,
} from "lucide-react";
import {
  getApiPanelData,
  setApiAutoBlock,
} from "@/lib/api-football.functions";

type PanelData = {
  count: number;
  budget: number;
  left: number | null;
  limit: number | null;
  autoBlock: boolean;
  pct: number;
  used: number;
  remaining: number;
  plan: string | null;
  planActive: boolean | null;
  planEnd: string | null;
};

const barColor = (pct: number) => {
  if (pct >= 80) return "bg-destructive";
  if (pct >= 60) return "bg-amber-500";
  return "bg-emerald-500";
};

const ringColor = (pct: number) => {
  if (pct >= 80) return "border-destructive text-destructive";
  if (pct >= 60) return "border-amber-500 text-amber-500";
  return "border-emerald-500 text-emerald-500";
};

export function ApiUsagePanel() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const fetchPanel = useServerFn(getApiPanelData);
  const fetchSetBlock = useServerFn(setApiAutoBlock);

  const q = useQuery<PanelData | null>({
    queryKey: ["api-panel"],
    queryFn: () => fetchPanel({}),
    staleTime: 30_000,
    refetchInterval: open ? 30_000 : 120_000,
  });

  const toggleBlock = useMutation({
    mutationFn: (on: boolean) => fetchSetBlock({ data: { on } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["api-panel"] });
    },
  });

  const s = q.data;
  const pct = s?.pct ?? 0;
  const used = s?.used ?? 0;
  const remaining = s?.remaining ?? 0;
  const limit = s?.limit ?? 0;
  const blocked80 = (s?.autoBlock ?? true) && pct >= 80;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Uso da API"
        className={`relative w-10 h-10 rounded-full bg-black/40 border flex items-center justify-center transition hover:bg-white/5 ${
          pct >= 80 ? "border-destructive/70 animate-pulse" : "border-white/10"
        }`}
        title={`API-Football · ${used.toLocaleString("pt-BR")} usadas · restam ${remaining.toLocaleString("pt-BR")}`}
      >
        <Activity className={`w-4 h-4 ${pct >= 80 ? "text-destructive" : pct >= 60 ? "text-amber-500" : "text-primary"}`} />
        {pct > 0 && (
          <span
            className={`absolute -bottom-1 -right-1 min-w-[18px] h-[18px] px-0.5 rounded-full border bg-black text-[9px] font-black flex items-center justify-center tabular-nums ${ringColor(pct)}`}
          >
            {pct}%
          </span>
        )}
        {blocked80 && (
          <span className="absolute -top-1 -left-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75 animate-ping" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-destructive" />
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md m-3 rounded-3xl border border-white/10 bg-gradient-to-b from-neutral-900 to-black p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-base font-bold leading-tight">Minha API-Football</h2>
                  <p className="text-[11px] text-muted-foreground">Quantas requisições usei / quanto falta</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["api-panel"] })}
                  className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center hover:bg-white/10" 
                  title="Atualizar agora"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setOpen(false)} className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {q.isLoading && <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>}

            {blocked80 && (
              <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-3.5 mb-3 flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-bold text-destructive">BLOQUEIO AUTOMÁTICO EM 80%</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Você usou <b>{pct}%</b> da cota de hoje. Tudo que roda sozinho (robô, scanner, varreduras) está
                    <b> pausado</b> para não estourar sua API sem autorização.
                  </p>
                </div>
              </div>
            )}

            {s && (
              <>
                <div className="rounded-2xl bg-black/50 border border-white/5 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">Requisições usadas hoje</span>
                    <span className={`text-[11px] font-black tabular-nums ${pct >= 80 ? "text-destructive" : pct >= 60 ? "text-amber-500" : "text-emerald-500"}`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-4xl font-black tabular-nums">{used.toLocaleString("pt-BR")}</span>
                    <span className="text-sm text-muted-foreground">/ {limit.toLocaleString("pt-BR")}</span>
                  </div>
                  <div className="mt-3 h-2.5 rounded-full bg-white/5 overflow-hidden relative">
                    <div className={`h-full ${barColor(pct)} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                    {pct < 100 && (
                      <div className="absolute top-0 bottom-0 w-0.5 bg-white/70" style={{ left: "80%" }} title="Limite de 80%" />
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-xl bg-white/5 p-2.5">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Usadas</p>
                      <p className="text-base font-bold tabular-nums mt-0.5">{used.toLocaleString("pt-BR")}</p>
                    </div>
                    <div className="rounded-xl bg-white/5 p-2.5">
                      <p className="text-[10px] uppercase text-muted-foreground font-bold">Faltam</p>
                      <p className="text-base font-bold tabular-nums mt-0.5 text-emerald-400">{remaining.toLocaleString("pt-BR")}</p>
                    </div>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Linha branca = 80% da cota · contador reinicia diariamente às 00:00 UTC
                  </p>
                </div>

                {/* Interruptor do bloqueio automático em 80% */}
                <div className="rounded-2xl bg-black/50 border border-white/5 p-4 mt-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {s.autoBlock ? (
                        <Shield className="w-5 h-5 text-primary" />
                      ) : (
                        <ShieldOff className="w-5 h-5 text-muted-foreground" />
                      )}
                      <div>
                        <p className="text-sm font-bold">Bloqueio automático em 80%</p>
                        <p className="text-[10px] text-muted-foreground">
                          {s.autoBlock
                            ? "AO chegar em 80% a API para tudo que roda sozinho (até você liberar)."
                            : "DESLIGADO — robô e scanner continuam usando a API até o fim da cota."}
                        </p>
                      </div>
                    </div>
                  </div>

                  {s.autoBlock ? (
                    <button
                      onClick={() => toggleBlock.mutate(false)}
                      disabled={toggleBlock.isPending}
                      className={`mt-3 w-full flex items-center justify-center gap-2 h-11 rounded-xl border text-xs font-bold uppercase tracking-wider transition disabled:opacity-50
                        ${pct >= 80 ? "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20" : "border-white/10 bg-white/5 text-muted-foreground hover:bg-white/10"}`}
                    >
                      <PowerOff className="w-4 h-4" />
                      Desligar bloqueio (continuar usando a API)
                    </button>
                  ) : (
                    <button
                      onClick={() => toggleBlock.mutate(true)}
                      disabled={toggleBlock.isPending}
                      className="mt-3 w-full flex items-center justify-center gap-2 h-11 rounded-xl border border-emerald-500/40 bg-emerald-500/10 text-emerald-500 text-xs font-bold uppercase tracking-wider transition hover:bg-emerald-500/20 disabled:opacity-50"
                    >
                      <Power className="w-4 h-4" />
                      Ligar bloqueio automático em 80%
                    </button>
                  )}

                  {pct >= 80 && s.autoBlock && (
                    <p className="text-[11px] text-destructive mt-2 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Cota em {pct}% — o bloqueio automático está segurando sua API.
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 mt-3">
                  <div className="rounded-2xl bg-black/50 border border-white/5 p-3">
                    <p className="text-[10px] uppercase text-muted-foreground font-bold">Plano</p>
                    <p className="text-sm font-bold mt-1">{s.plan ?? "—"}</p>
                  </div>
                  <div className="rounded-2xl bg-black/50 border border-white/5 p-3">
                    <p className="text-[10px] uppercase text-muted-foreground font-bold">Status</p>
                    <p className="text-sm font-bold mt-1 flex items-center gap-1">
                      {s.planActive === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : s.planActive ? (
                        <><CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Ativo</>
                      ) : (
                        <><AlertTriangle className="w-3.5 h-3.5 text-destructive" /> Inativo</>
                      )}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-black/50 border border-white/5 p-3 col-span-2">
                    <p className="text-[10px] uppercase text-muted-foreground font-bold">Expira em</p>
                    <p className="text-sm font-bold mt-1">
                      {s.planEnd ? new Date(s.planEnd).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "—"}
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}