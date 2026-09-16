import { createFileRoute } from "@tanstack/react-router";
import { isAuthorizedCronRequest } from "@/lib/cron-auth.server";

/** Dry-run de validação cruzada (Poisson → mercados complexos) e análise live via Gemini. */
async function run({ request }: { request: Request }): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) return new Response("Unauthorized", { status: 401 });
  try {
    const url = new URL(request.url);
    const raw = Number(url.searchParams.get("limit") ?? 10);
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 10, 1), 10);
    const daysBack = Math.min(Math.max(Number(url.searchParams.get("daysBack") ?? 3), 1), 3);
    const mode = url.searchParams.get("mode") ?? "dry-run";

    const { pickFinishedFixtures, runComplexMarketsDryRun, analyzeComplexMarketsLive } =
      await import("@/lib/ai-complex-markets.server");

    const found = await pickFinishedFixtures(limit, daysBack);
    const refs = found.map((f) => ({
      id: f.fixture.id,
      homeId: f.teams.home.id,
      awayId: f.teams.away.id,
      homeName: f.teams.home.name,
      awayName: f.teams.away.name,
      leagueName: f.league.name,
      round: f.league.round,
    }));

    const body =
      mode === "live"
        ? await analyzeComplexMarketsLive(refs, limit)
        : await runComplexMarketsDryRun(refs, limit);

    return Response.json({ ok: true, candidates: found.length, ...body });
  } catch (e) {
    console.error("[ai/complex-markets]", (e as Error).message);
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/ai/complex-markets")({
  server: {
    handlers: {
      GET: run,
    },
  },
});