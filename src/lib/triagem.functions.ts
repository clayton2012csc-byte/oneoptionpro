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

export const getTriagemCertificacao = createServerFn({ method: "GET" })
  .inputValidator((d: { days?: number; limit?: number } = {}) => d)
  .handler(async ({ data }) => {
    const { triagemCertificacao } = await import("./triagem.server");
    try {
      return await triagemCertificacao(data?.days ?? 21, data?.limit ?? 3000);
    } catch (e) {
      console.warn("[triagem] certificação indisponível:", (e as Error).message);
      return { total: 0, fixtures: [], routingRate: 0 };
    }
  });

export const getTriagemEvolucao = createServerFn({ method: "GET" })
  .inputValidator((d: { days?: number } = {}) => d)
  .handler(async ({ data }) => {
    const { triagemEvolucao } = await import("./triagem.server");
    try {
      return await triagemEvolucao(data?.days ?? 60);
    } catch (e) {
      console.warn("[triagem] evolução indisponível:", (e as Error).message);
      return { days: [], markets: [], totalAnalyzed: 0, totalPublished: 0, overallAccuracy: 0 };
    }
  });
