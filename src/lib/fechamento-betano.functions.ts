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

/** Carrega o fechamento com dados de estatísticas e especiais Betano unificados. */
export const getFechamentoUnificado = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ fechamento: FechamentoSnapshot; specials: Record<number, any[]> }> => {
    try {
      const { getFechamentoBetanoSnapshot } = await import("./fechamento-betano.server");
      const fechamento = await getFechamentoBetanoSnapshot(false);

      // Busca os palpites de cada jogo para montar os especiais Betano
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: autoRows } = await supabaseAdmin
        .from("auto_tickets")
        .select("fixture_id, picks")
        .neq("status", "skipped")
        .gte("kickoff", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .lte("kickoff", new Date(Date.now() + 30 * 60 * 60 * 1000).toISOString());

      const specials: Record<number, any[]> = {};
      if (autoRows) {
        for (const row of autoRows) {
          const picks = row.picks as any[] | null;
          if (picks && picks.length > 0) {
            specials[Number(row.fixture_id)] = picks;
          }
        }
      }

      return { fechamento, specials };
    } catch (e) {
      console.warn("[fechamento] falha ao carregar dados unificados:", (e as Error).message);
      return { fechamento: EMPTY(), specials: {} };
    }
  },
);
