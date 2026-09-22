/** Beta — gerador híbrido (client-safe server function). */
import { createServerFn } from "@tanstack/react-start";
import { BETA_STAKE, type BetaSnapshot } from "./beta-hibrido";

export const getBetaHibrido = createServerFn({ method: "GET" }).handler(async (): Promise<BetaSnapshot> => {
  const { betaHibridoSnapshot } = await import("./beta-hibrido.server");
  try {
    return await betaHibridoSnapshot();
  } catch (e) {
    console.warn("[beta] gerador híbrido indisponível:", (e as Error).message);
    return { day: "", builtAt: new Date().toISOString(), stake: BETA_STAKE, games: [], scanned: 0 };
  }
});
