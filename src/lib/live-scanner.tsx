import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLiveFixtures, type ApiFixture } from "./api-football.functions";
import { getBulkPredictions, type ScanPrediction } from "./bulk-predictions.functions";
import { criteriaScore } from "./bingao-criteria";
import { playAlert, notifyAlert, requestNotifications } from "./alert-sound";
import { toast } from "sonner";

export interface LiveOpportunity extends ScanPrediction {
  fixture: ApiFixture;
}

interface LiveScannerContextType {
  isActive: boolean;
  setIsActive: (active: boolean) => void;
  lastScanAt: Date | null;
  foundOpportunities: LiveOpportunity[];
  clearOpportunities: () => void;
}

const LiveScannerContext = createContext<LiveScannerContextType | undefined>(undefined);

const SCAN_INTERVAL = 900_000; // 15 minutos — economiza cota da API
const MAX_SCAN_FIXTURES = 8; // cada jogo custa ~12 chamadas na API
const NOTIFIED_FIXTURES_KEY = "oneoption:notified_fixtures";

export function LiveScannerProvider({ children }: { children: React.ReactNode }) {
  const [isActive, setIsActiveState] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("oneoption:scanner_active") === "true";
  });
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);
  const [foundOpportunities, setFoundOpportunities] = useState<LiveOpportunity[]>([]);
  
  const fetchLive = useServerFn(getLiveFixtures);
  const fetchBulk = useServerFn(getBulkPredictions);
  const queryClient = useQueryClient();

  const setIsActive = useCallback((active: boolean) => {
    setIsActiveState(active);
    if (typeof window !== "undefined") {
      localStorage.setItem("oneoption:scanner_active", String(active));
      if (active) {
        requestNotifications();
      }
    }
  }, []);

  const getNotified = useCallback(() => {
    if (typeof window === "undefined") return new Set<number>();
    const stored = localStorage.getItem(NOTIFIED_FIXTURES_KEY);
    return new Set<number>(stored ? JSON.parse(stored) : []);
  }, []);

  const saveNotified = useCallback((id: number) => {
    if (typeof window === "undefined") return;
    const notified = getNotified();
    notified.add(id);
    localStorage.setItem(NOTIFIED_FIXTURES_KEY, JSON.stringify(Array.from(notified)));
  }, [getNotified]);

  const scan = useCallback(async () => {
    if (!isActive) return;

    try {
      console.log("[LiveScanner] Iniciando varredura ao vivo...");
      const liveFixtures = await fetchLive();
      if (!liveFixtures || liveFixtures.length === 0) return;

      // Filtra jogos que ainda não terminaram e estão em andamento
      const activeLive = liveFixtures.filter(f => 
        ["1H", "HT", "2H", "ET", "P"].includes(f.fixture.status.short)
      );

      if (activeLive.length === 0) return;

      const predictions = await fetchBulk({
        data: {
          fixtures: activeLive.map(f => ({
            id: f.fixture.id,
            homeId: f.teams.home.id,
            awayId: f.teams.away.id
          }))
        }
      });

      const notified = getNotified();
      const newOpps: LiveOpportunity[] = [];
      const { saveMatchPrediction } = await import("./match-predictions");

      for (const pred of predictions) {
        const fixture = activeLive.find(f => f.fixture.id === pred.fixtureId);
        if (!fixture) continue;

        const goals = (fixture.goals.home ?? 0) + (fixture.goals.away ?? 0);
        if (goals >= 2) continue;

        if (pred.pUnder15 > 0.65 && !notified.has(pred.fixtureId)) {
          newOpps.push({ ...pred, fixture });
          saveNotified(pred.fixtureId);
          
          // Persistência automática do sinal no site (IA Indicator)
          try {
            await saveMatchPrediction({
              fixtureId: pred.fixtureId,
              market: "u15",
              probability: Math.round(pred.pUnder15 * 100),
              score: 0,
              features: { live: true, minute: fixture.fixture.status.elapsed, score: `${fixture.goals.home}-${fixture.goals.away}` }
            });
          } catch (err) {
            console.warn("Falha ao salvar sinal do radar:", err);
          }

          const title = `🔥 Oportunidade Under 1.5: ${fixture.teams.home.name} x ${fixture.teams.away.name}`;
          const body = `Probabilidade: ${Math.round(pred.pUnder15 * 100)}% | Placar: ${fixture.goals.home}-${fixture.goals.away}`;
          
          playAlert("high");
          notifyAlert(title, body);
          toast.success(title, {
            description: body,
            duration: 10000,
          });
        }
      }

      setFoundOpportunities(prev => [...newOpps, ...prev].slice(0, 20));
      setLastScanAt(new Date());
    } catch (error) {
      console.error("[LiveScanner] Erro na varredura:", error);
    }
  }, [isActive, fetchLive, fetchBulk, getNotified, saveNotified]);

  const clearOpportunities = useCallback(() => {
    setFoundOpportunities([]);
  }, []);

  useEffect(() => {
    if (!isActive) return;

    // Executa o primeiro scan após um pequeno delay
    const timer = setTimeout(scan, 2000);
    
    const interval = setInterval(scan, SCAN_INTERVAL);
    
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [isActive, scan]);

  return (
    <LiveScannerContext.Provider value={{ isActive, setIsActive, lastScanAt, foundOpportunities, clearOpportunities }}>
      {children}
    </LiveScannerContext.Provider>
  );
}

export function useLiveScanner() {
  const context = useContext(LiveScannerContext);
  if (context === undefined) {
    throw new Error("useLiveScanner must be used within a LiveScannerProvider");
  }
  return context;
}
