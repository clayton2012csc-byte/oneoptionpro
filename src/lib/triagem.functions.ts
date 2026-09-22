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

/** Confere agora as triagens de jogos encerrados (usa o placar já salvo — não gasta API). */
export const runTriagemGrading = createServerFn({ method: "POST" }).handler(async () => {
  const { gradeTriagemBacklog } = await import("./triagem.server");
  try {
    return { graded: await gradeTriagemBacklog() };
  } catch (e) {
    console.warn("[triagem] conferência indisponível:", (e as Error).message);
    return { graded: 0 };
  }
});

/** Lê as avaliações da Triagem de uma lista de jogos (9 mercados) — fonte única para cards/selos. */
export const getTriagemByFixtures = createServerFn({ method: "POST" })
  .inputValidator((d: { ids: number[] }) => ({ ids: (d?.ids ?? []).map(Number) }))
  .handler(async ({ data }) => {
    const { triagemByFixtures } = await import("./triagem.server");
    try {
      return await triagemByFixtures(data.ids);
    } catch (e) {
      console.warn("[triagem] leitura por fixtures indisponível:", (e as Error).message);
      return [];
    }
  });

/** Lê TODAS as triagens dos jogos das próximas 24h — pré-carga no login. */
export const getProximas24hSelos = createServerFn({ method: "POST" }).handler(async () => {
  const { proximas24hTriagem } = await import("./triagem.server");
  try {
    return await proximas24hTriagem();
  } catch (e) {
    console.warn("[triagem] pré-carga 24h indisponível:", (e as Error).message);
    return [];
  }
});
