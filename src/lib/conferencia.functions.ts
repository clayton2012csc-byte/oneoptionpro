/** Conferência por aba e resolução da conta demo — client-safe. */
import { createServerFn } from "@tanstack/react-start";
import type { ConferenciaAba } from "./conferencia.server";

export type { ConferenciaAba } from "./conferencia.server";

export const getConferenciaAba = createServerFn({ method: "POST" })
  .inputValidator((d: { dias?: number; markets?: string[] }) => ({
    dias: Math.min(Math.max(Number(d?.dias) || 7, 1), 30),
    markets: Array.isArray(d?.markets) ? d.markets.slice(0, 20).map(String) : undefined,
  }))
  .handler(async ({ data }): Promise<ConferenciaAba> => {
    try {
      const { conferenciaAba } = await import("./conferencia.server");
      return await conferenciaAba(data.dias, data.markets);
    } catch (e) {
      console.warn("[conferencia] falha:", (e as Error).message);
      return { dias: data.dias, greens: 0, reds: 0, voids: 0, acerto: 0, mercados: [], porDia: [], recentes: [] };
    }
  });

export const resolverApostasDemo = createServerFn({ method: "POST" })
  .inputValidator((d: { items: { fixtureId: number; market: string; selection: string }[] }) => ({
    items: (Array.isArray(d?.items) ? d.items : []).slice(0, 600).map((i) => ({
      fixtureId: Number(i.fixtureId),
      market: String(i.market),
      selection: String(i.selection),
    })),
  }))
  .handler(async ({ data }) => {
    try {
      const { resolverPalpites } = await import("./conferencia.server");
      return await resolverPalpites(data.items);
    } catch (e) {
      console.warn("[conferencia] resolver demo falhou:", (e as Error).message);
      return {} as Record<string, "green" | "red" | "void">;
    }
  });
