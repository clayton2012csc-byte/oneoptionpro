/**
 * Aba Auditoria — conferência read-only do estado do site (apenas Supabase,
 * zero custo de API-Football). Mostra status de bilhetes/triagem, conflitos
 * de palpites no mesmo jogo e cobertura das próximas 24h.
 */
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Ticket,
} from "lucide-react";
import { getAuditoria } from "@/lib/auditoria.functions";
import type { AuditoriaCompleta } from "@/lib/auditoria.server";

function Stat({ label, value, tone = "text-foreground" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="glass rounded-2xl border border-white/10 px-3 py-2.5">
      <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-black tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function statusCount(obj: Record<string, number> | undefined): string {
  if (!obj || !Object.keys(obj).length) return "—";
  const def = { pending: 0, graded: 0, skipped: 0, void: 0, green: 0, red: 0 };
  const merged = { ...def, ...obj };
  return `${merged.pending} pendentes · ${merged.graded} conferidos · ${merged.skipped} pulados${merged.void ? ` · ${merged.void} anulados` : ""}`;
}

export function TriagemAuditoriaPanel() {
  const fetchAud = useServerFn(getAuditoria);
  const q = useQuery({
    queryKey: ["auditoria", "completa"],
    queryFn: () => fetchAud({}),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });

  const d: AuditoriaCompleta | undefined = q.data;
  const conflitos = d?.conflitos ?? [];
  const deTriagem = conflitos.filter((c) => c.tipo === "triagem").length;
  const deTickets = conflitos.filter((c) => c.tipo === "auto_tickets").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Auditoria · só leitura do Supabase · sem custo de API
        </span>
        <button
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-bold text-muted-foreground hover:bg-white/10 cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${q.isFetching ? "animate-spin" : ""}`} />
          Reconferir
        </button>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Conferindo…</p>}
      {q.error && <p className="text-sm text-destructive">Erro: {(q.error as Error).message}</p>}

      {!q.isLoading && d && (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat
              label="Bilhetes IA (auto_tickets)"
              value={statusCount(d.resumo.auto_tickets)}
            />
            <Stat
              label="Triagem"
              value={statusCount(d.resumo.triagem)}
            />
            <Stat
              label="Selos scan_snapshot (48h)"
              value={d.resumo.ai_predictions_48h}
              tone={d.resumo.ai_predictions_48h ? "text-primary" : "text-amber-300"}
            />
            <Stat
              label="Jogos 24h com selo"
              value={d.resumo.cobertura_24h.fixtures}
              tone={d.resumo.cobertura_24h.fixtures ? "text-emerald-400" : "text-amber-300"}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <div className="glass rounded-2xl border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {deTriagem === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                )}
                Conflitos na Triagem
              </div>
              <div className={`mt-1 text-2xl font-black tabular-nums ${deTriagem === 0 ? "text-emerald-400" : "text-red-400"}`}>
                {deTriagem}
              </div>
              {deTriagem === 0 && <div className="text-[10px] text-muted-foreground">nenhum jogo com mercados opostos</div>}
            </div>
            <div className="glass rounded-2xl border px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {deTickets === 0 ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                )}
                Conflitos em auto_tickets
              </div>
              <div className={`mt-1 text-2xl font-black tabular-nums ${deTickets === 0 ? "text-emerald-400" : "text-red-400"}`}>
                {deTickets}
              </div>
              {deTickets === 0 && <div className="text-[10px] text-muted-foreground">nenhum palpite oposto no mesmo jogo</div>}
            </div>
          </div>

          <div className="glass rounded-2xl border border-white/10 px-3 py-2.5">
            <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
              Cobertura próximas 24h
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums">
              <span>
                <Ticket className="mr-1 inline h-3 w-3 text-muted-foreground" />
                {d.resumo.cobertura_24h.bilhetes_pending} bilhetes prontos
              </span>
              <span>{d.resumo.cobertura_24h.mercados_publicados} mercados publicados na Triagem</span>
              <span>· {d.resumo.cobertura_24h.bilhetes_skipped} pulados</span>
            </div>
          </div>

          {conflitos.length > 0 && (
            <div className="glass rounded-2xl border border-red-500/30 overflow-hidden">
              <div className="px-3 py-2 text-[11px] font-black uppercase tracking-wider text-red-400 border-b border-white/10">
                Detalhes dos conflitos
              </div>
              <div className="divide-y divide-white/5 max-h-64 overflow-y-auto">
                {conflitos.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11px]">
                    <span className="font-black tabular-nums">{c.fixture_id}</span>
                    <span className="text-muted-foreground">{c.match_name ?? ""}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-bold">{c.mercado}</span>
                    <span className="text-amber-300">{c.lados.join(" × ")}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Conflito = mercados/seleções opostas no mesmo jogo (Under×Over, Ambas Sim×Não, 1X2 duplicado).
            Conferida às {new Date(d.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
          </p>
        </>
      )}
    </div>
  );
}