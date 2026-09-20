/**
 * Conta Demo x Conta Real.
 *
 * Padrão de aposta único para TODAS as abas do site:
 *  - saldo inicial da demo: R$ 100,00
 *  - valor fixo por aposta: R$ 0,50
 * Cada seleção registrada vira uma aposta de R$ 0,50 na conta demo,
 * para medirmos se os bilhetes montados dão lucro ou prejuízo.
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const DEMO_START_BALANCE = 100;
export const DEFAULT_BET_STAKE = 0.5;

export type AccountMode = "demo" | "real";
export type DemoBetStatus = "pending" | "green" | "red" | "void";

export type DemoBetKind = "simples" | "multipla";

export interface DemoLeg {
  fixtureId: number;
  home: string;
  away: string;
  league?: string | null;
  kickoff?: string;
  market: string;
  selection: string;
  odd: number;
  prob?: number;
  status?: "green" | "red" | null;
}

export interface DemoBet {
  id: string;
  createdAt: string;
  /** de onde saiu o bilhete: aba/seção do site */
  source: string;
  fixtureId: number;
  home: string;
  away: string;
  league?: string;
  kickoff?: string;
  market: string;
  selection: string;
  odd: number;
  prob?: number;
  stake: number;
  status: DemoBetStatus;
  settledAt?: string;
  /** simples = 1 seleção · múltipla = várias seleções no mesmo bilhete */
  kind?: DemoBetKind;
  /** apostado automaticamente pelo robô */
  auto?: boolean;
  legs?: DemoLeg[];
}

export interface DemoBetInput {
  source: string;
  fixtureId: number;
  home: string;
  away: string;
  league?: string;
  kickoff?: string;
  market: string;
  selection: string;
  odd?: number;
  prob?: number;
}

/** Bilhete montado pelo robô (simples ou múltipla). */
export interface DemoTicketInput {
  id: string;
  source: string;
  kind: DemoBetKind;
  legs: DemoLeg[];
  odd: number;
  prob?: number;
}

interface DemoState {
  mode: AccountMode;
  balance: number;
  bets: DemoBet[];
  stake: number;
  /** robô apostando sozinho na conta demo */
  autopilot: boolean;
  setMode: (mode: AccountMode) => void;
  setStake: (stake: number) => void;
  setAutopilot: (on: boolean) => void;
  /** registra apostas de R$ 0,50 cada; devolve quantas entraram */
  placeBets: (inputs: DemoBetInput[]) => number;
  /** registra bilhetes do robô (simples e múltiplas); devolve quantos entraram */
  placeTickets: (tickets: DemoTicketInput[]) => number;
  /** liquida em lote os bilhetes já conferidos pelo robô */
  applyResults: (results: { id: string; status: "green" | "red" }[]) => number;
  settle: (id: string, status: DemoBetStatus) => void;
  removeBet: (id: string) => void;
  reset: () => void;
}

const betKey = (b: DemoBetInput) => `${b.fixtureId}:${b.market}:${b.selection}`;

export const useDemoAccount = create<DemoState>()(
  persist(
    (set, get) => ({
      mode: "demo",
      balance: DEMO_START_BALANCE,
      bets: [],
      stake: DEFAULT_BET_STAKE,
      autopilot: true,
      setMode: (mode) => set({ mode }),
      setStake: (stake) => set({ stake: Math.max(0.1, Number(stake) || DEFAULT_BET_STAKE) }),
      setAutopilot: (on) => set({ autopilot: on }),
      placeTickets: (tickets) => {
        const { bets, stake, balance } = get();
        const known = new Set(bets.map((b) => b.id));
        const fresh: DemoBet[] = [];
        let left = balance;
        for (const t of tickets) {
          if (known.has(t.id) || !t.legs.length) continue;
          if (left < stake) break;
          known.add(t.id);
          left = Number((left - stake).toFixed(2));
          const first = t.legs[0]!;
          fresh.push({
            id: t.id,
            createdAt: new Date().toISOString(),
            source: t.source,
            fixtureId: first.fixtureId,
            home: first.home,
            away: first.away,
            league: first.league ?? undefined,
            kickoff: first.kickoff,
            market: t.kind === "multipla" ? `${t.legs.length} seleções` : first.market,
            selection: t.kind === "multipla" ? t.legs.map((l) => l.selection).join(" + ") : first.selection,
            odd: t.odd > 1 ? Number(t.odd.toFixed(2)) : 2,
            prob: t.prob,
            stake,
            status: "pending",
            kind: t.kind,
            auto: true,
            legs: t.legs,
          });
        }
        if (!fresh.length) return 0;
        set({ bets: [...fresh, ...bets], balance: left });
        return fresh.length;
      },
      applyResults: (results) => {
        const { bets } = get();
        const map = new Map(results.map((r) => [r.id, r.status]));
        let gain = 0;
        let count = 0;
        const next = bets.map((b) => {
          const status = map.get(b.id);
          if (!status || b.status !== "pending") return b;
          count += 1;
          if (status === "green") gain += b.stake * b.odd;
          return { ...b, status, settledAt: new Date().toISOString() };
        });
        if (!count) return 0;
        set({ bets: next, balance: Number((get().balance + gain).toFixed(2)) });
        return count;
      },
      placeBets: (inputs) => {
        const { bets, stake, balance } = get();
        const existing = new Set(bets.filter((b) => b.status === "pending").map((b) => b.id));
        const fresh: DemoBet[] = [];
        let left = balance;
        for (const input of inputs) {
          const id = betKey(input);
          if (existing.has(id)) continue;
          if (left < stake) break;
          existing.add(id);
          left = Number((left - stake).toFixed(2));
          fresh.push({
            id,
            createdAt: new Date().toISOString(),
            source: input.source,
            fixtureId: input.fixtureId,
            home: input.home,
            away: input.away,
            league: input.league,
            kickoff: input.kickoff,
            market: input.market,
            selection: input.selection,
            odd: input.odd && input.odd > 1 ? Number(input.odd.toFixed(2)) : 2,
            prob: input.prob,
            stake,
            status: "pending",
          });
        }
        if (!fresh.length) return 0;
        set({ bets: [...fresh, ...bets], balance: left });
        return fresh.length;
      },
      settle: (id, status) =>
        set((s) => {
          const bet = s.bets.find((b) => b.id === id);
          if (!bet || bet.status !== "pending") return s;
          const gain =
            status === "green" ? bet.stake * bet.odd : status === "void" ? bet.stake : 0;
          return {
            bets: s.bets.map((b) =>
              b.id === id ? { ...b, status, settledAt: new Date().toISOString() } : b,
            ),
            balance: Number((s.balance + gain).toFixed(2)),
          };
        }),
      removeBet: (id) =>
        set((s) => {
          const bet = s.bets.find((b) => b.id === id);
          if (!bet) return s;
          const back = bet.status === "pending" ? bet.stake : 0;
          return {
            bets: s.bets.filter((b) => b.id !== id),
            balance: Number((s.balance + back).toFixed(2)),
          };
        }),
      reset: () => set({ balance: DEMO_START_BALANCE, bets: [] }),
    }),
    {
      name: "oneoption-demo-account",
      partialize: (s) => ({
        mode: s.mode,
        balance: s.balance,
        bets: s.bets,
        stake: s.stake,
        autopilot: s.autopilot,
      }),
    },
  ),
);

export interface DemoStats {
  total: number;
  pending: number;
  green: number;
  red: number;
  invested: number;
  returned: number;
  profit: number;
  roi: number;
  hitRate: number;
  exposure: number;
}

export function demoStats(bets: DemoBet[]): DemoStats {
  const settled = bets.filter((b) => b.status === "green" || b.status === "red");
  const invested = bets.reduce((s, b) => s + b.stake, 0);
  const returned = bets.reduce(
    (s, b) => s + (b.status === "green" ? b.stake * b.odd : b.status === "void" ? b.stake : 0),
    0,
  );
  const green = bets.filter((b) => b.status === "green").length;
  const settledInvested = settled.reduce((s, b) => s + b.stake, 0);
  const settledReturn = settled.reduce((s, b) => s + (b.status === "green" ? b.stake * b.odd : 0), 0);
  return {
    total: bets.length,
    pending: bets.filter((b) => b.status === "pending").length,
    green,
    red: bets.filter((b) => b.status === "red").length,
    invested: Number(invested.toFixed(2)),
    returned: Number(returned.toFixed(2)),
    profit: Number((settledReturn - settledInvested).toFixed(2)),
    roi: settledInvested ? ((settledReturn - settledInvested) / settledInvested) * 100 : 0,
    hitRate: settled.length ? (green / settled.length) * 100 : 0,
    exposure: Number(bets.filter((b) => b.status === "pending").reduce((s, b) => s + b.stake, 0).toFixed(2)),
  };
}

export const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
