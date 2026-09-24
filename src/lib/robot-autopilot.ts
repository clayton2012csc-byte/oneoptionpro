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
import { resolverApostasDemo } from "./conferencia.functions";
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

/**
 * Confere sozinho TODAS as apostas pendentes da conta demo (manuais e do robô)
 * cujos jogos já começaram há 2h+, usando os bilhetes já conferidos no banco.
 */
export function useDemoSettler() {
  const bets = useDemoAccount((s) => s.bets);
  const settle = useDemoAccount((s) => s.settle);
  const resolve = useServerFn(resolverApostasDemo);
  const due = bets.filter(
    (b) => b.status === "pending" && (!b.kickoff || new Date(b.kickoff).getTime() < Date.now() - 2 * 3600_000),
  );
  const legsOf = (b: (typeof bets)[number]) =>
    b.legs?.length ? b.legs : [{ fixtureId: b.fixtureId, market: b.market, selection: b.selection }];
  const items = due.flatMap((b) => legsOf(b).map((l) => ({ fixtureId: l.fixtureId, market: l.market, selection: l.selection })));
  const q = useQuery({
    queryKey: ["demo-settler", items.map((i) => `${i.fixtureId}|${i.market}|${i.selection}`).sort().join(",")],
    queryFn: () => resolve({ data: { items } }),
    enabled: items.length > 0,
    staleTime: 10 * 60_000,
    refetchInterval: 10 * 60_000,
  });
  useEffect(() => {
    const map = q.data;
    if (!map) return;
    for (const b of due) {
      const st = legsOf(b).map((l) => map[`${l.fixtureId}|${l.market}|${l.selection}`]);
      if (st.some((x) => x === "red")) settle(b.id, "red");
      else if (st.every((x) => x === "void")) settle(b.id, "void");
      else if (st.every((x) => x === "green" || x === "void")) settle(b.id, "green");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
}
