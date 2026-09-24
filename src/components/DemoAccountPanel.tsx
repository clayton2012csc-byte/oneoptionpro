import { useMemo } from "react";
import { Check, X, Trash2, RotateCcw, FlaskConical, Bot, Play, Pause } from "lucide-react";
import { toast } from "sonner";
import {
  useDemoAccount,
  demoStats,
  brl,
  DEMO_START_BALANCE,
  type DemoBet,
} from "@/lib/demo-account";
import { useRobotAutopilot } from "@/lib/robot-autopilot";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[9px] font-black uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`text-lg font-black tabular ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function BetRow({ bet }: { bet: DemoBet }) {
  const settle = useDemoAccount((s) => s.settle);
  const removeBet = useDemoAccount((s) => s.removeBet);
  const pending = bet.status === "pending";
  const multi = bet.kind === "multipla" && (bet.legs?.length ?? 0) > 1;
  const tone =
    bet.status === "green"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : bet.status === "red"
        ? "border-destructive/30 bg-destructive/5"
        : "border-white/10 bg-white/[0.03]";
  return (
    <div className={`rounded-2xl border p-3 ${tone}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[9px] font-black uppercase tracking-widest text-primary truncate flex items-center gap-1">
            {bet.auto && <Bot className="w-3 h-3" />}
            {bet.source}
            <span className="text-muted-foreground">· {multi ? "múltipla" : "simples"}</span>
          </div>
          {multi ? (
            <div className="text-xs font-black">{bet.legs!.length} seleções no bilhete</div>
          ) : (
            <>
              <div className="text-xs font-black truncate">
                {bet.home} × {bet.away}
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {bet.market}: {bet.selection}
              </div>
            </>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[9px] uppercase font-black text-muted-foreground">Odd</div>
          <div className="text-sm font-black text-primary tabular">{bet.odd.toFixed(2)}</div>
          <div className="text-[10px] text-muted-foreground tabular">{brl(bet.stake)}</div>
        </div>
        {pending ? (
          <div className="flex gap-1 shrink-0">
            <button
              onClick={() => settle(bet.id, "green")}
              aria-label="Marcar como ganha"
              className="w-9 h-9 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-300 hover:bg-emerald-500/20"
            >
              <Check className="w-4 h-4" />
            </button>
            <button
              onClick={() => settle(bet.id, "red")}
              aria-label="Marcar como perdida"
              className="w-9 h-9 rounded-full bg-destructive/10 border border-destructive/30 flex items-center justify-center text-destructive hover:bg-destructive/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span
            className={`shrink-0 text-[10px] font-black uppercase tracking-widest ${
              bet.status === "green" ? "text-emerald-300" : bet.status === "red" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {bet.status === "green" ? "Green" : bet.status === "red" ? "Red" : "Anulada"}
          </span>
        )}
        <button
          onClick={() => removeBet(bet.id)}
          aria-label="Remover aposta"
          className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-destructive shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {multi && (
        <div className="mt-2 space-y-1 border-t border-white/10 pt-2">
          {bet.legs!.map((l, i) => (
            <div key={`${l.fixtureId}-${i}`} className="flex items-center gap-2 text-[11px]">
              <span
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  l.status === "green"
                    ? "bg-emerald-400"
                    : l.status === "red"
                      ? "bg-destructive"
                      : "bg-muted-foreground/40"
                }`}
              />
              <span className="font-bold truncate">
                {l.home} × {l.away}
              </span>
              <span className="text-muted-foreground truncate flex-1">{l.selection}</span>
              <span className="tabular text-primary font-black shrink-0">{l.odd.toFixed(2)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DemoAccountPanel() {
  const bets = useDemoAccount((s) => s.bets);
  const balance = useDemoAccount((s) => s.balance);
  const stake = useDemoAccount((s) => s.stake);
  const reset = useDemoAccount((s) => s.reset);
  const autopilot = useDemoAccount((s) => s.autopilot);
  const setAutopilot = useDemoAccount((s) => s.setAutopilot);
  const stats = useMemo(() => demoStats(bets), [bets]);
  const robot = useRobotAutopilot();
  const autoBets = bets.filter((b) => b.auto).length;

  return (
    <div className="p-3 sm:p-4 space-y-4">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
              <FlaskConical className="w-3.5 h-3.5" /> Conta demo
            </div>
            <div className="text-3xl font-black tabular">{brl(balance)}</div>
            <p className="text-[11px] text-muted-foreground mt-1">
              Começa com {brl(DEMO_START_BALANCE)}. O robô aposta {brl(stake)} por bilhete, simples e
              múltiplas, em todas as abas.
            </p>
          </div>
          <button
            onClick={() => {
              reset();
              toast.success("Conta demo reiniciada com " + brl(DEMO_START_BALANCE));
            }}
            className="h-9 px-3 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest flex items-center gap-1 hover:bg-white/10 transition shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reiniciar
          </button>
        </div>
      </div>

      <div className="rounded-3xl border border-primary/25 bg-primary/[0.06] p-4 backdrop-blur-xl flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-black uppercase tracking-widest text-primary flex items-center gap-1">
            <Bot className="w-3.5 h-3.5" /> Robô apostador
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {autopilot
              ? `Ligado: ${autoBets} bilhetes já apostados sozinho. Ele confere o resultado e credita o retorno automaticamente.`
              : "Desligado. Ligue para o robô montar e apostar sozinho os bilhetes de cada aba."}
          </p>
          {robot.isFetching && (
            <div className="text-[10px] text-muted-foreground mt-1">procurando bilhetes…</div>
          )}
        </div>
        <button
          onClick={() => {
            setAutopilot(!autopilot);
            toast.success(autopilot ? "Robô pausado" : "Robô ligado: apostando sozinho na demo");
          }}
          className={`h-9 px-3 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-1 transition shrink-0 border ${
            autopilot
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-white/5 border-white/10 hover:bg-white/10"
          }`}
        >
          {autopilot ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          {autopilot ? "Pausar" : "Ligar"}
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Stat label="Apostado" value={brl(stats.invested)} />
        <Stat
          label="Lucro / prejuízo"
          value={brl(stats.profit)}
          tone={stats.profit >= 0 ? "text-emerald-300" : "text-destructive"}
        />
        <Stat
          label="Retorno (ROI)"
          value={`${stats.roi.toFixed(1)}%`}
          tone={stats.roi >= 0 ? "text-emerald-300" : "text-destructive"}
        />
        <Stat label="Acerto" value={`${stats.hitRate.toFixed(0)}%`} />
        <Stat label="Em aberto" value={`${stats.pending}`} />
        <Stat label="Ganhas" value={`${stats.green}`} tone="text-emerald-300" />
        <Stat label="Perdidas" value={`${stats.red}`} tone="text-destructive" />
        <Stat label="Em jogo" value={brl(stats.exposure)} />
      </div>
      <DemoAuditoria bets={bets} />

      <div className="space-y-2">
        {bets.length === 0 && (
          <div className="text-center py-16 text-sm text-muted-foreground">
            Nenhuma aposta ainda. Monte um bilhete em qualquer aba e toque em “Apostar na demo”.
          </div>
        )}
        {bets.map((b) => (
          <BetRow key={b.id + b.createdAt} bet={b} />
        ))}
      </div>
    </div>
  );
}

function DemoAuditoria({ bets }: { bets: DemoBet[] }) {
  const rows = useMemo(() => {
    const m = new Map<string, { g: number; r: number; p: number; inv: number; ret: number }>();
    for (const b of bets) {
      const k = b.source || "Outros";
      const x = m.get(k) ?? { g: 0, r: 0, p: 0, inv: 0, ret: 0 };
      if (b.status === "green") { x.g++; x.inv += b.stake; x.ret += b.stake * b.odd; }
      else if (b.status === "red") { x.r++; x.inv += b.stake; }
      else if (b.status === "pending") x.p++;
      m.set(k, x);
    }
    return [...m.entries()].sort((a, b) => b[1].g + b[1].r - (a[1].g + a[1].r));
  }, [bets]);
  if (!rows.length) return null;
  return (
    <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
      <div className="text-[10px] font-black uppercase tracking-widest text-primary mb-1">Auditoria da conta demo</div>
      <p className="text-[11px] text-muted-foreground mb-3">Green/Red por aba. As apostas são conferidas sozinhas quando o jogo termina.</p>
      <div className="space-y-1.5">
        {rows.map(([src, x]) => {
          const t = x.g + x.r;
          const acc = t ? x.g / t : 0;
          const lucro = x.ret - x.inv;
          return (
            <div key={src} className="flex items-center gap-2 text-[11px]">
              <span className="flex-1 truncate font-semibold">{src}</span>
              <span className="text-emerald-300 tabular">{x.g}G</span>
              <span className="text-destructive tabular">{x.r}R</span>
              <span className="text-muted-foreground tabular">{x.p} abertas</span>
              <span className={`w-12 text-right font-black tabular ${!t ? "text-muted-foreground" : acc >= 0.5 ? "text-emerald-300" : "text-destructive"}`}>{t ? `${Math.round(acc * 100)}%` : "—"}</span>
              <span className={`w-16 text-right font-black tabular ${lucro >= 0 ? "text-emerald-300" : "text-destructive"}`}>{brl(lucro)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
