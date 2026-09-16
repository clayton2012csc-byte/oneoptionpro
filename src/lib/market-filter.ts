
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MarketFilterId = 
  | "none"
  | "u15" 
  | "o15"
  | "u25" 
  | "o25" 
  | "btts_yes" 
  | "btts_no" 
  | "corners_u95" 
  | "corners_o95"
  | "smart_ia";

/** Subconjunto leve de um palpite do bilhete automático (11 mercados) persistido no card. */
export interface AutoPickLite {
  market: string;
  selection: string;
  prob: number;
}

export interface ScanPrediction {
  fixtureId: number;
  pUnder15: number;
  pOver15: number;
  pUnder25: number;
  pOver25: number;
  pBTTS: number;
  pNoBTTS: number;
  pCornersOver95: number;
  bestMarket?: MarketFilterId;
  bestProb?: number;
  topMarkets?: { id: MarketFilterId; prob: number }[];
  /** início da partida (ISO) — usado pelo filtro "Próximas 3h" sem nova consulta */
  kickoff?: string;
  /** palpite de placar exato seco + demais mercados do bilhete automático */
  picks?: AutoPickLite[];
}

interface MarketFilterState {
  market: MarketFilterId;
  predictions: ScanPrediction[];
  // Novos estados para persistir múltiplos selos
  persistedPredictions: ScanPrediction[];
  setMarket: (market: MarketFilterId) => void;
  setPredictions: (predictions: ScanPrediction[]) => void;
  addPersistedPredictions: (newPredictions: ScanPrediction[]) => void;
  clearPredictions: () => void;
  clearPersistedPredictions: () => void;
}

export const useMarketFilter = create<MarketFilterState>()(
  persist(
    (set) => ({
      market: "none",
      predictions: [],
      persistedPredictions: [],
      setMarket: (market) => set({ market }),
      setPredictions: (predictions) => set({ predictions }),
      addPersistedPredictions: (newPredictions) => set((state) => {
        const map = new Map(state.persistedPredictions.map(p => [p.fixtureId, p]));
        newPredictions.forEach(p => {
          const existing = map.get(p.fixtureId);
          if (existing) {
            map.set(p.fixtureId, { ...existing, ...p });
          } else {
            map.set(p.fixtureId, p);
          }
        });
        return { persistedPredictions: Array.from(map.values()) };
      }),
      clearPredictions: () => set({ predictions: [] }),
      clearPersistedPredictions: () => set({ persistedPredictions: [] }),
    }),
    {
      name: "market-filter-storage",
      // Apenas os selos dos cartões são persistidos.
      // O mercado selecionado e o resultado da varredura NÃO persistem entre sessões,
      // para nunca esconder jogos das listas ao reabrir o app.
      partialize: (state) => ({ persistedPredictions: state.persistedPredictions }) as any,
    }
  )
);
