import type { QueryClient } from "@tanstack/react-query";
import {
  getMatchPreview, getH2H, getStandings, getFixtureStatistics, getFixtureLineups,
  type ApiFixture,
} from "@/lib/api-football.functions";

const done = new Set<number>();

/**
 * Busca em paralelo tudo que a página do jogo mostra (resumo, previsão,
 * estatísticas, H2H, classificação e — perto do início — escalações).
 * Usa as mesmas chaves das abas, então cada aba abre já preenchida.
 * Tudo passa pelo cache do servidor/banco; nada é buscado duas vezes.
 */
export function prefetchMatch(qc: QueryClient, f: ApiFixture) {
  const id = f?.fixture?.id;
  if (!id || done.has(id)) return;
  done.add(id);
  const homeId = f.teams.home.id;
  const awayId = f.teams.away.id;
  const opts = { staleTime: 45 * 60_000 };

  void qc.prefetchQuery({
    queryKey: ["preview", id],
    queryFn: () => getMatchPreview({ data: { homeId, awayId, last: 5 } }),
    ...opts,
  });
  void qc.prefetchQuery({
    queryKey: ["h2h", homeId, awayId],
    queryFn: () => getH2H({ data: { h2h: `${homeId}-${awayId}`, last: 10 } }),
    ...opts,
  });
  if (f.league?.id && f.league?.season) {
    void qc.prefetchQuery({
      queryKey: ["standings", f.league.id, f.league.season],
      queryFn: () => getStandings({ data: { league: f.league.id, season: f.league.season } }),
      ...opts,
    });
  }
  const kickoff = new Date(f.fixture.date).getTime();
  const started = Date.now() >= kickoff;
  if (started) {
    void qc.prefetchQuery({
      queryKey: ["stats", id],
      queryFn: () => getFixtureStatistics({ data: { id } }),
      staleTime: 60_000,
    });
  }
  if (kickoff - Date.now() < 90 * 60_000) {
    void qc.prefetchQuery({
      queryKey: ["lineups", id],
      queryFn: async () => await getFixtureLineups({ data: { id } }),
      staleTime: 60 * 60_000,
    });
  }
}
