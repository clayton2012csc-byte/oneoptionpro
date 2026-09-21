import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Mantém o cache das telas (selos, estatísticas, listas já carregadas) salvo no
 * navegador, para que ao voltar/recarregar o site apareça preenchido na hora,
 * sem novas chamadas à API.
 */
export function usePersistedQueryCache(queryClient: QueryClient) {
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      try {
        const [{ persistQueryClient }, { createSyncStoragePersister }] = await Promise.all([
          import("@tanstack/react-query-persist-client"),
          import("@tanstack/query-sync-storage-persister"),
        ]);
        if (cancelled) return;

        const persister = createSyncStoragePersister({
          storage: window.localStorage,
          key: "oneoption-query-cache",
          throttleTime: 2000,
        });

        const [unsubscribe, restored] = persistQueryClient({
          queryClient: queryClient as never,
          persister,
          maxAge: 12 * 60 * 60_000,
          buster: "v1",
        });
        void restored;
        dispose = unsubscribe;
      } catch (err) {
        console.error("[cache] não foi possível salvar o cache local", err);
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [queryClient]);
}
