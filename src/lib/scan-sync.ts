/**
 * Hook cliente que unifica os números: ao abrir um jogo, manda a previsão real
 * (últimos 5 jogos) para regravar os selos daquele jogo. Não gasta API.
 */
import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import type { TeamPreviewStats } from "./api-football.functions";
import { syncScanSnapshot } from "./scan-sync.functions";
import { useMarketFilter } from "./market-filter";

const done = new Set<number>();

export function useScanSync(
  fixtureId: number | undefined,
  homeName: string | undefined,
  awayName: string | undefined,
  preview: { home: TeamPreviewStats; away: TeamPreviewStats } | undefined,
) {
  const sync = useServerFn(syncScanSnapshot);
  const addPersisted = useMarketFilter((s) => s.addPersistedPredictions);
  const busy = useRef(false);

  useEffect(() => {
    if (!fixtureId || !homeName || !awayName || !preview) return;
    if (!preview.home?.played || !preview.away?.played) return;
    if (done.has(fixtureId) || busy.current) return;
    busy.current = true;
    done.add(fixtureId);
    sync({ data: { fixtureId, homeName, awayName, home: preview.home, away: preview.away } })
      .then((res) => {
        if (res?.picks?.length) addPersisted([{ fixtureId, picks: res.picks } as never]);
      })
      .catch(() => done.delete(fixtureId))
      .finally(() => {
        busy.current = false;
      });
  }, [fixtureId, homeName, awayName, preview, sync, addPersisted]);
}
