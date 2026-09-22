/** Auditoria read-only — server functions (client-safe). */
import { createServerFn } from "@tanstack/react-start";

const VAZIO = {
  timestamp: "",
  resumo: {
    auto_tickets: {},
    triagem: {},
    ai_predictions_48h: 0,
    cobertura_24h: { fixtures: 0, mercados_publicados: 0, bilhetes_pending: 0, bilhetes_skipped: 0 },
  },
  conflitos: [],
  conflitos_por_tipo: { triagem: 0, auto_tickets: 0 },
};

/** Auditoria completa de conflitos e status — só leitura do Supabase (zero API-Football). */
export const getAuditoria = createServerFn({ method: "GET" }).handler(async () => {
  const { auditoriaCompleta } = await import("./auditoria.server");
  try {
    return await auditoriaCompleta();
  } catch (e) {
    console.warn("[auditoria] indisponível:", (e as Error).message);
    return VAZIO;
  }
});