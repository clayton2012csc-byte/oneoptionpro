import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getFixturesByDate } from "@/lib/api-football.functions";
import { LeagueGroup, groupFixtures } from "@/components/LeagueGroup";
import { useFavorites } from "@/lib/favorites";
import { LoadingList, EmptyState } from "@/components/StateViews";
import { BackHeader } from "@/components/BackHeader";

function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }

export const Route = createFileRoute("/proximo")({
  head: () => ({
    meta: [
      { title: "Próximos jogos de futebol — Terror da Bet" },
      { name: "description", content: "Confira os próximos jogos de futebol do dia com horários em tempo real." },
    ],
  }),
  component: ProximoPage,
});

function ProximoPage() {
  const date = today();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const favorites = useFavorites();
  const fetchFixtures = useServerFn(getFixturesByDate);
  const q = useQuery({
    queryKey: ["fixtures", "date", date],
    queryFn: () => fetchFixtures({ data: { date } }),
    staleTime: 5 * 60_000,
    refetchInterval: 300_000,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const upcoming = (q.data ?? [])
    .filter((f) => {
      const status = f.fixture.status.short;
      return (status === "NS" || status === "TBD") && f.fixture.timestamp * 1000 > nowMs;
    })
    .sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);

  return (
    <div className="pt-4">
      <BackHeader title="Próximos jogos" />
      {q.isLoading && <LoadingList />}
      {q.data && upcoming.length === 0 && <EmptyState text="Nenhum jogo agendado restante hoje." />}
      {upcoming.length > 0 && groupFixtures(upcoming, favorites).map((g) => <LeagueGroup key={g.key} group={g} />)}
    </div>
  );
}
