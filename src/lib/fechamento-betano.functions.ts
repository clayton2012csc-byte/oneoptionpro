/** Server functions do Fechamento Betano 3/4. */
import { createServerFn } from "@tanstack/react-start";
import { DEFAULT_STAKE, type FechamentoSnapshot } from "./fechamento-betano";

const EMPTY = (): FechamentoSnapshot => ({
  day: "",
  builtAt: new Date().toISOString(),
  stake: DEFAULT_STAKE,
  games: [],
});

export const getFechamentoBetano = createServerFn({ method: "GET" }).handler(
  async (): Promise<FechamentoSnapshot> => {
    try {
      const { getFechamentoBetanoSnapshot } = await import("./fechamento-betano.server");
      return await getFechamentoBetanoSnapshot(false);
    } catch (e) {
      console.warn("[fechamento] indisponível:", (e as Error).message);
      return EMPTY();
    }
  },
);

export const rebuildFechamentoBetano = createServerFn({ method: "POST" }).handler(
  async (): Promise<FechamentoSnapshot> => {
    try {
      const { getFechamentoBetanoSnapshot } = await import("./fechamento-betano.server");
      return await getFechamentoBetanoSnapshot(true);
    } catch (e) {
      console.warn("[fechamento] falha ao remontar:", (e as Error).message);
      return EMPTY();
    }
  },
);
