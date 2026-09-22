import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery, useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getLeagueInfo, getStandings, getFixturesByLeague, type ApiFixture, type ApiStandingRow } from "@/lib/api-football.functions";
import { MatchCard } from "@/components/MatchCard";
import { BackHeader } from "@/components/BackHeader";
import { useState } from "react";
import { useTriagemSync } from "@/lib/triagem-view";

const leagueInfoQO = (id: number) =>
  queryOptions({
    queryKey: ["league-info", id],
    queryFn: () => getLeagueInfo({ data: { id } }),
  });

export const Route = createFileRoute("/liga/$leagueId")({
  head: ({ params }) => ({
    meta: [
      { title: `Liga ${params.leagueId} — OneOptiOn` },
      { name: "description", content: "Classificação e jogos da liga." },
    ],
  }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(leagueInfoQO(Number(params.leagueId))),
  component: LeaguePage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6 text-center">
        <p className="text-sm text-muted-foreground mb-3">Erro ao carregar liga: {error.message}</p>
        <button onClick={() => { reset(); router.invalidate(); }} className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm">
          Tentar novamente
        </button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6 text-center text-sm text-muted-foreground">Liga não encontrada.</div>,
});

function LeaguePage() {
  const { leagueId } = Route.useParams();
  const id = Number(leagueId);
  const { data: info } = useSuspenseQuery(leagueInfoQO(id));

  const currentSeason = info?.seasons?.find((s) => s.current)?.year
    ?? info?.seasons?.[info.seasons.length - 1]?.year
    ?? new Date().getFullYear();

  const [tab, setTab] = useState<"upcoming" | "results" | "standings">("upcoming");

  const standingsQ = useQuery({
    queryKey: ["standings", id, currentSeason],
    queryFn: () => getStandings({ data: { league: id, season: currentSeason } }),
  });

  const upcomingQ = useQuery({
    queryKey: ["league-fixtures", id, currentSeason, "next"],
    queryFn: () => getFixturesByLeague({ data: { league: id, season: currentSeason, next: 30 } }),
    enabled: tab === "upcoming",
  });

  const resultsQ = useQuery({
    queryKey: ["league-fixtures", id, currentSeason, "last"],
    queryFn: () => getFixturesByLeague({ data: { league: id, season: currentSeason, last: 30 } }),
    enabled: tab === "results",
  });

  const rows: ApiStandingRow[] = standingsQ.data?.[0]?.league?.standings?.[0] ?? [];

  return (
    <div className="space-y-4">
      <BackHeader
        title={info?.league?.name ?? `Liga ${id}`}
        extra={
          <div className="flex-1 min-w-0 pr-12">
            <p className="text-[10px] text-muted-foreground truncate">
              {info?.country?.name ?? ""} · Temporada {currentSeason}
            </p>
          </div>
        }
      />

      <div className="rounded-2xl bg-card border border-white/5 p-4 flex items-center gap-4">
        {info?.league?.logo && (
          <img src={info.league.logo} alt={info.league.name} className="w-14 h-14 object-contain" />
        )}
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold truncate">{info?.league?.name ?? `Liga ${id}`}</h2>
          <p className="text-xs text-muted-foreground truncate">
            {info?.country?.name ?? ""} · Temporada {currentSeason}
          </p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-white/5">
        {([
          ["upcoming", "Próximos"],
          ["results", "Resultados"],
          ["standings", "Classificação"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === k ? "border-primary text-white" : "border-transparent text-muted-foreground hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "upcoming" && <FixtureList q={upcomingQ} empty="Sem jogos agendados." />}
      {tab === "results" && <FixtureList q={resultsQ} empty="Sem resultados recentes." />}
      {tab === "standings" && (
        <StandingsTable rows={rows} loading={standingsQ.isLoading} />
      )}
    </div>
  );
}

function FixtureList({ q, empty }: { q: { data?: ApiFixture[]; isLoading: boolean }; empty: string }) {
  const list = q.data ?? [];
  useTriagemSync(list.map((f) => f.fixture.id));
  if (q.isLoading) return <div className="p-6 text-center text-sm text-muted-foreground">Carregando…</div>;
  if (!list.length) return <div className="p-6 text-center text-sm text-muted-foreground">{empty}</div>;
  return (
    <div className="space-y-2">
      {list.map((f) => <MatchCard key={f.fixture.id} fixture={f} />)}
    </div>
  );
}

function StandingsTable({ rows, loading }: { rows: ApiStandingRow[]; loading: boolean }) {
  if (loading) return <div className="p-6 text-center text-sm text-muted-foreground">Carregando classificação…</div>;
  if (!rows.length) return <div className="p-6 text-center text-sm text-muted-foreground">Sem classificação disponível.</div>;
  return (
    <div className="rounded-2xl bg-card border border-white/5 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-xs text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">#</th>
            <th className="text-left px-3 py-2">Time</th>
            <th className="text-center px-2 py-2">J</th>
            <th className="text-center px-2 py-2">V</th>
            <th className="text-center px-2 py-2">E</th>
            <th className="text-center px-2 py-2">D</th>
            <th className="text-center px-2 py-2">SG</th>
            <th className="text-center px-2 py-2 font-bold">P</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id} className="border-t border-white/5 hover:bg-white/5">
              <td className="px-3 py-2 text-muted-foreground">{r.rank}</td>
              <td className="px-3 py-2">
                <Link to="/time/$teamId" params={{ teamId: String(r.team.id) }} className="flex items-center gap-2 hover:text-primary">
                  <img src={r.team.logo} alt="" className="w-5 h-5 object-contain" />
                  <span className="truncate">{r.team.name}</span>
                </Link>
              </td>
              <td className="text-center px-2 py-2">{r.all.played}</td>
              <td className="text-center px-2 py-2">{r.all.win}</td>
              <td className="text-center px-2 py-2">{r.all.draw}</td>
              <td className="text-center px-2 py-2">{r.all.lose}</td>
              <td className="text-center px-2 py-2">{r.goalsDiff}</td>
              <td className="text-center px-2 py-2 font-bold">{r.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
