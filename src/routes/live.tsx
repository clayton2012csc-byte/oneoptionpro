import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getLiveFixtures } from "@/lib/api-football.functions";
import { LeagueGroup, groupFixtures } from "@/components/LeagueGroup";
import { useFavorites } from "@/lib/favorites";
import { LoadingList, EmptyState } from "@/components/StateViews";
import { BackHeader } from "@/components/BackHeader";

export const Route = createFileRoute("/live")({
  head: () => ({
    meta: [
      { title: "Jogos ao vivo agora — Terror da Bet" },
      { name: "description", content: "Todos os jogos de futebol acontecendo agora com placar minuto a minuto." },
    ],
  }),
  component: LivePage,
});

function LivePage() {
  const fetchLive = useServerFn(getLiveFixtures);
  const favorites = useFavorites();
  const q = useQuery({
    queryKey: ["fixtures", "live"],
    queryFn: () => fetchLive({}),
    staleTime: 2 * 60_000,
    refetchInterval: 180_000,
  });

  return (
    <div className="pt-4">
      <BackHeader title="Ao vivo agora" />
      {q.isLoading && <LoadingList />}
      {q.error && <p className="p-4 text-sm text-destructive">Erro: {(q.error as Error).message}</p>}
      {q.data && q.data.length === 0 && <EmptyState text="Nenhum jogo ao vivo no momento." />}
      {q.data && q.data.length > 0 && groupFixtures(q.data, favorites).map((g) => <LeagueGroup key={g.key} group={g} />)}
    </div>
  );
}
