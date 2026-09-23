import { getFixturesByDate, getMatchPreview, getH2H, getStandings, FINISHED_STATUSES } from "./api-football.functions";

function spDay(offset = 0) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(Date.now() + offset * 86_400_000));
}

/**
 * "Abre" antecipadamente os jogos: grava no banco a prévia, H2H e classificação
 * de cada partida ainda não encerrada, para que a primeira abertura seja instantânea.
 */
export async function warmMatches(opts: { day?: number; offset?: number; limit?: number }) {
  const date = spDay(opts.day ?? 0);
  const all = ((await getFixturesByDate({ data: { date } })) ?? []).filter(
    (f) => !FINISHED_STATUSES.has(f.fixture.status.short),
  );
  // Pula jogos já preparados: cada execução pega só os novos/expirados.
  const { getCachedData } = await import("./api-football-cache.server");
  const pending: typeof all = [];
  for (const f of all) {
    const hit = await getCachedData(`preview:${f.teams.home.id}:${f.teams.away.id}:5`).catch(() => null);
    if (!hit) pending.push(f);
  }
  const slice = pending.slice(opts.offset ?? 0, (opts.offset ?? 0) + (opts.limit ?? 20));
  const seenStandings = new Set<string>();
  let ok = 0;
  for (let i = 0; i < slice.length; i += 4) {
    await Promise.all(
      slice.slice(i, i + 4).map(async (f) => {
        const h = f.teams.home.id, a = f.teams.away.id;
        const sk = `${f.league.id}:${f.league.season}`;
        const jobs: Promise<unknown>[] = [
          getMatchPreview({ data: { homeId: h, awayId: a, last: 5 } }),
          getH2H({ data: { h2h: `${h}-${a}`, last: 10 } }),
        ];
        if (!seenStandings.has(sk)) {
          seenStandings.add(sk);
          jobs.push(getStandings({ data: { league: f.league.id, season: f.league.season } }));
        }
        const r = await Promise.allSettled(jobs);
        if (r.every((x) => x.status === "fulfilled")) ok++;
      }),
    );
  }
  return { date, total: all.length, offset: opts.offset ?? 0, pending: pending.length, processed: slice.length, warmed: ok };
}
