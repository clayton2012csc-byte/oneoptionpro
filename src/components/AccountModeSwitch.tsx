import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { FlaskConical, Wallet } from "lucide-react";
import { useDemoAccount, brl } from "@/lib/demo-account";

/** Chave Conta Demo / Conta Real com o saldo simulado ao lado. */
export function AccountModeSwitch() {
  const mode = useDemoAccount((s) => s.mode);
  const setMode = useDemoAccount((s) => s.setMode);
  const balance = useDemoAccount((s) => s.balance);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const demo = mode === "demo";
  return (
    <div className="flex items-center gap-1">
      <div className="flex items-center rounded-lg bg-card/70 border border-white/10 p-0.5 backdrop-blur-xl">
        <button
          onClick={() => setMode("demo")}
          className={`h-8 px-2 rounded-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition ${
            demo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title="Conta demo: apostas simuladas de R$ 0,50 para medir lucro ou prejuízo"
        >
          <FlaskConical className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Demo</span>
        </button>
        <button
          onClick={() => setMode("real")}
          className={`h-8 px-2 rounded-md text-[10px] font-black uppercase tracking-wider flex items-center gap-1 transition ${
            !demo ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
          title="Conta real: o site só mostra os bilhetes, nada é simulado"
        >
          <Wallet className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Real</span>
        </button>
      </div>
      {demo && (
        <Link
          to="/demo"
          className="hidden sm:inline-flex items-center h-8 px-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-black tabular text-emerald-200 hover:border-emerald-400/60 transition"
          title="Abrir a conta demo"
        >
          {brl(balance)}
        </Link>
      )}
    </div>
  );
}
