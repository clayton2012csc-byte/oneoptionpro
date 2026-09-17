/** Triagem — server functions (client-safe). */
import { createServerFn } from "@tanstack/react-start";

export const getTriagemBoard = createServerFn({ method: "GET" }).handler(async () => {
  const { triagemBoard } = await import("./triagem.server");
  try {
    return await triagemBoard();
  } catch (e) {
    console.warn("[triagem] painel indisponível:", (e as Error).message);
    return { markets: [], total: 0 };
  }
});
