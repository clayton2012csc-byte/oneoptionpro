/**
 * Piloto automático do robô na conta demo.
 *
 * A cada 5 minutos o robô lê os bilhetes do dia (simples e múltiplas de cada
 * aba), registra sozinho as apostas de R$ 0,50 na conta demo e liquida as que
 * já foram conferidas. Nenhuma chamada extra à API-Football é feita.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { robotPlays } from "./robot-bets.functions";
import { useDemoAccount } from "./demo-account";

export function useRobotPlays(enabled = true) {
  const fetchPlays = useServerFn(robotPlays);
  return useQuery({
    queryKey: ["robot-plays"],
    queryFn: () => fetchPlays({}),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useRobotAutopilot() {
  const mode = useDemoAccount((s) => s.mode);
  const autopilot = useDemoAccount((s) => s.autopilot);
  const placeTickets = useDemoAccount((s) => s.placeTickets);
  const applyResults = useDemoAccount((s) => s.applyResults);
  const active = mode === "demo" && autopilot;
  const query = useRobotPlays(active);

  useEffect(() => {
    const plays = query.data?.plays;
    if (!active || !plays?.length) return;
    placeTickets(
      plays.map((p) => ({
        id: p.id,
        source: p.source,
        kind: p.kind,
        odd: p.odd,
        prob: p.prob,
        legs: p.legs,
      })),
    );
    applyResults(
      plays
        .filter((p) => p.status === "green" || p.status === "red")
        .map((p) => ({ id: p.id, status: p.status as "green" | "red" })),
    );
  }, [query.data, active, placeTickets, applyResults]);

  return query;
}
