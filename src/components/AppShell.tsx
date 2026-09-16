import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { Search, RefreshCw, Trophy, X, Globe, ChevronDown, LogIn, LogOut, User } from "lucide-react";
import { useQueryClient, useIsFetching } from "@tanstack/react-query";
import { LeagueSidebar, RightPanel, LeagueList } from "./SidePanels";
import { ScannerToggle } from "./ScannerToggle";
import { useActiveSection, setActiveSection } from "@/lib/active-section";
import { setSearchQuery, useSearchQuery } from "@/lib/search-query";
import { ApiUsagePanel } from "./ApiUsagePanel";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

import { SECTIONS } from "@/lib/sections-config";
import { BetSlipDrawer } from "./BetSlipDrawer";

function SectionMenu() {
  const active = useActiveSection();
  const [open, setOpen] = useState(false);
  const current = SECTIONS.find((s) => s.id === active);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Escolher página"
        className="inline-flex items-center gap-1 h-9 px-2 sm:px-2.5 rounded-lg bg-card/70 border border-white/10 text-xs font-bold hover:border-primary/40 transition backdrop-blur-xl"
      >
        <Globe className="w-4 h-4 text-primary" />
        <span className="hidden sm:inline max-w-[110px] truncate">
          {current?.label ?? "Páginas"}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <>
          <button
            aria-hidden
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-11 z-50 w-56 rounded-xl glass p-1.5 shadow-xl">
            {SECTIONS.map((s) => {
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setActiveSection(s.id);
                    setOpen(false);
                  }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-left transition ${
                    isActive ? "bg-primary/15 text-primary" : "hover:bg-white/5 text-foreground"
                  }`}
                >
                  <span className="text-base leading-none">{s.icon}</span>
                  <span className="flex-1 min-w-0 truncate font-semibold">{s.label}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function TopBar() {
  const qc = useQueryClient();
  const fetching = useIsFetching();
  const currentQuery = useSearchQuery();
  const [value, setValue] = useState(currentQuery);
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchQuery(value.trim());
  };
  const onChange = (v: string) => {
    setValue(v);
    setSearchQuery(v.trim());
  };
  const refresh = () => {
    qc.invalidateQueries();
  };

  const handleSignOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/" });
  };

  return (
    <header className="sticky top-0 z-30 bg-background/75 backdrop-blur-2xl border-b border-white/10 shadow-lg shadow-background/30">
      <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-6 h-16">
        <Link to="/" className="flex items-center gap-2 group shrink-0">
          <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center shadow-md shadow-primary/15 group-hover:scale-105 transition-all duration-300">
            <span className="text-primary-foreground font-black text-base">1O</span>
          </div>
          <span className="hidden sm:inline text-xl font-black tracking-tighter text-foreground group-hover:opacity-80 transition-opacity">
            OneOptiOn<span className="text-primary">IA</span>
          </span>
        </Link>
        <form onSubmit={onSubmit} className="flex-1 min-w-0 max-w-xl relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground/40" />
          <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Times, ligas ou mercados..."
            className="w-full h-11 pl-11 pr-4 rounded-xl bg-card/60 border border-white/10 text-sm placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/45 focus:bg-card/85 transition-all"
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <SectionMenu />
          <button
            onClick={refresh}
            disabled={fetching > 0}
            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary border border-primary text-primary-foreground text-xs font-bold uppercase tracking-wider shadow-md shadow-primary/10 hover:bg-primary/90 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${fetching > 0 ? "animate-spin" : ""}`} />
            Atualizar
          </button>
          <button
            onClick={refresh}
            disabled={fetching > 0}
            aria-label="Atualizar"
            className="sm:hidden w-9 h-9 rounded-lg bg-primary border border-primary text-primary-foreground flex items-center justify-center shadow-md shadow-primary/10 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${fetching > 0 ? "animate-spin" : ""}`} />
          </button>
          <ApiUsagePanel />
          <ScannerToggle />
          {!authLoading &&
            (user ? (
              <div className="flex items-center gap-1">
                <div
                  className="hidden sm:flex items-center gap-1.5 h-9 px-2.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-xs"
                  title="Seus dados estão sincronizados na nuvem — aparecem em qualquer aparelho com este login"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <User className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="truncate max-w-[140px] text-emerald-100">{user.email}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400/80">
                    sync
                  </span>
                </div>
                <button
                  onClick={handleSignOut}
                  title="Sair"
                  className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/40"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <Link
                to="/auth"
                className="inline-flex items-center justify-center gap-1.5 w-9 sm:w-auto h-9 sm:px-3 rounded-lg bg-primary text-primary-foreground text-xs font-bold uppercase tracking-wider hover:bg-primary/90"
                aria-label="Entrar"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Entrar</span>
              </Link>
            ))}
        </div>
      </div>
    </header>
  );
}

function SectionRail() {
  const active = useActiveSection();
  return (
    <aside className="hidden md:flex w-20 shrink-0 flex-col items-center gap-3 py-6 border-r border-white/10 bg-card/25 backdrop-blur-xl">
      {SECTIONS.map((s) => {
        const isActive = active === s.id;
        const cls = `w-14 py-3 rounded-xl flex flex-col items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest transition-all duration-300 relative group ${
          isActive
            ? "bg-primary/15 text-primary border border-primary/30"
            : "text-muted-foreground hover:bg-white/10 hover:text-foreground border border-transparent"
        }`;

        const content = (
          <>
            <span className="text-xl leading-none">{s.icon}</span>
            <span className="truncate w-full text-center px-1 leading-tight">{s.label}</span>
          </>
        );

        if (s.href) {
          return (
            <Link
              key={s.id}
              to={s.href}
              target="_self"
              onClick={() => setActiveSection(s.id)}
              className={cls}
            >
              {content}
            </Link>
          );
        }

        return (
          <button key={s.id} onClick={() => setActiveSection(s.id)} className={cls}>
            {content}
          </button>
        );
      })}
    </aside>
  );
}

function MobileNav() {
  const active = useActiveSection();
  const [ligas, setLigas] = useState(false);
  return (
    <>
      {ligas && (
        <div className="md:hidden fixed inset-0 z-50 flex">
          <button
            aria-label="Fechar ligas"
            onClick={() => setLigas(false)}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />
          <div className="relative ml-auto w-[85vw] max-w-xs h-full bg-background border-l border-white/10 p-3 overflow-y-auto">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Ligas
              </span>
              <button
                onClick={() => setLigas(false)}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <LeagueList onNavigate={() => setLigas(false)} />
          </div>
        </div>
      )}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur border-t border-white/10 pb-[env(safe-area-inset-bottom)]">
        <div className="flex gap-1 overflow-x-auto scrollbar-none px-2 py-1.5">
          {SECTIONS.map((s) => {
            const isActive = active === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`shrink-0 min-w-[68px] px-2 py-1.5 rounded-xl flex flex-col items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider border transition ${
                  isActive
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-muted-foreground border-transparent"
                }`}
              >
                <span className="text-lg leading-none">{s.icon}</span>
                <span className="truncate w-full text-center leading-tight">{s.label}</span>
              </button>
            );
          })}
          <button
            onClick={() => setLigas(true)}
            className="shrink-0 min-w-[68px] px-2 py-1.5 rounded-xl flex flex-col items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border border-transparent"
          >
            <Trophy className="w-4.5 h-4.5" />
            <span>Ligas</span>
          </button>
        </div>
      </nav>
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />
      <div className="flex">
        <SectionRail />
        <div className="flex-1 min-w-0 flex gap-3 p-2 sm:p-3 pb-24 md:pb-3">
          <LeagueSidebar />
          <main className="flex-1 min-w-0 rounded-2xl bg-card/45 border border-white/10 overflow-hidden shadow-xl shadow-background/35 backdrop-blur-xl">
            {children}
          </main>
          <RightPanel />
        </div>
      </div>
      <MobileNav />
      <BetSlipDrawer />
    </div>
  );
}
