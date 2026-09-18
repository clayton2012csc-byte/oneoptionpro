/** Server functions das Múltiplas Populares (3 bilhetes do dia). */
import { createServerFn } from "@tanstack/react-start";
import type { PopularMultiplesSnapshot } from "./multiplas.server";

export type { PopularMultiple, MultipleLeg, PopularMultiplesSnapshot } from "./multiplas.server";

const EMPTY = (): PopularMultiplesSnapshot => ({
  day: "",
  builtAt: new Date().toISOString(),
  tickets: [],
});

/** Lê (ou monta, se ainda não existir) as múltiplas do dia. */
export const popularMultiples = createServerFn({ method: "GET" }).handler(
  async (): Promise<PopularMultiplesSnapshot> => {
    try {
      const { getPopularMultiples } = await import("./multiplas.server");
      return await getPopularMultiples(false);
    } catch (e) {
      console.warn("[multiplas] indisponível:", (e as Error).message);
      return EMPTY();
    }
  },
);

/** Remonta as múltiplas do dia com os palpites mais recentes. */
export const rebuildPopularMultiples = createServerFn({ method: "POST" }).handler(
  async (): Promise<PopularMultiplesSnapshot> => {
    try {
      const { getPopularMultiples } = await import("./multiplas.server");
      return await getPopularMultiples(true);
    } catch (e) {
      console.warn("[multiplas] falha ao remontar:", (e as Error).message);
      return EMPTY();
    }
  },
);
