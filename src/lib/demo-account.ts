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

interface DemoState {
  mode: AccountMode;
  balance: number;
  bets: DemoBet[];
  stake: number;
  setMode: (mode: AccountMode) => void;
  setStake: (stake: number) => void;
  /** registra apostas de R$ 0,50 cada; devolve quantas entraram */
  placeBets: (inputs: DemoBetInput[]) => number;
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
      setMode: (mode) => set({ mode }),
      setStake: (stake) => set({ stake: Math.max(0.1, Number(stake) || DEFAULT_BET_STAKE) }),
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
      partialize: (s) => ({ mode: s.mode, balance: s.balance, bets: s.bets, stake: s.stake }),
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
