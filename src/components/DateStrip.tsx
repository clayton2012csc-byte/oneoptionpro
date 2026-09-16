import { Link } from "@tanstack/react-router";
import { Calendar, Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { autoTicketStatus } from "@/lib/auto-tickets.functions";

function AutoStatusBadge() {
  const fetchStatus = useServerFn(autoTicketStatus);
  const { data } = useQuery({
    queryKey: ["auto-ticket-status"],
    queryFn: () => fetchStatus(),
    staleTime: 60_000,
    refetchInterval: 600_000,
  });
  if (!data || data.total === 0) return null;
  return (
    <div
      title="Bilhetes automáticos: jogos das próximas 24h já com as estatísticas e previsões dos 11 mercados salvas no banco"
      className="shrink-0 h-14 px-3 rounded-full bg-black/60 border border-emerald-500/30 flex flex-col items-center justify-center gap-0.5 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
    >
      <div className="flex items-center gap-1">
        <Bot className="w-3 h-3 text-emerald-400" />
        <span className="text-[9px] font-black text-emerald-400 tracking-widest uppercase">
          {data.coverage}%
        </span>
      </div>
      <span className="text-[8px] font-bold text-emerald-100/60 whitespace-nowrap">
        {data.ready} jogos prontos
      </span>
    </div>
  );
}

function fmt(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

const WD = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

import { memo } from "react";

const LABELS = ["ONTEM", "HOJE", "AMANHÃ"] as const;

export const DateStrip = memo(function DateStrip({ selected }: { selected: string }) {
  // O "hoje" depende do fuso do navegador: só calculamos após a hidratação.
  const [todayStr, setTodayStr] = useState<string | null>(null);
  useEffect(() => setTodayStr(fmt(new Date())), []);

  const base = parseIso(todayStr ?? selected);
  const days: Date[] = [];
  for (let i = -1; i <= 1; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    days.push(d);
  }

  return (
    <div className="flex items-stretch gap-2 px-3 py-3 overflow-x-auto scrollbar-none">
      {days.map((d, i) => {
        const iso = fmt(d);
        const isSel = iso === selected;
        const label = LABELS[i];
        const sub = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} · ${WD[d.getDay()]}`;
        return (
          <Link
            key={iso}
            to="/"
            search={{ date: iso }}
            className={`flex-1 min-w-[92px] px-4 h-16 flex flex-col items-center justify-center rounded-xl text-center transition-all duration-300 active:scale-95 border ${
              isSel
                ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/15 scale-[1.02]"
                : "border-white/10 bg-card/65 text-foreground hover:bg-accent hover:border-white/15"
            }`}
          >
            <span className={`text-[10px] font-black tracking-widest ${isSel ? "text-primary-foreground" : "text-foreground"}`}>{label}</span>
            <span className={`text-xs font-black tabular mt-0.5 ${isSel ? "text-primary-foreground" : "text-muted-foreground"}`}>{sub}</span>
          </Link>
        );
      })}
       <button className="shrink-0 w-12 h-16 rounded-xl bg-card/65 border border-white/10 flex items-center justify-center hover:bg-accent" title="Calendário">
        <Calendar className="w-4 h-4" />
      </button>
      <AutoStatusBadge />
    </div>
  );
});
