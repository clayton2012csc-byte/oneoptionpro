/**
 * Catálogo de tools do Assistente (tool-calling) — TODAS read-only e consultam
 * apenas o Supabase (triagem_records, auto_tickets, ai_predictions). Zero
 * chamadas à API-Football. O modelo nunca executa SQL: só invoca essas funções.
 */
import type { ToolDecl } from "./ai-provider.server";

export const ASSISTANT_TOOLS: ToolDecl[] = [
  {
    name: "auditoria_completa",
    description:
      "Auditoria completa do site: status de bilhetes (auto_tickets) e da Triagem, conflitos de palpites no mesmo jogo (ex.: Under+Over, Ambas Sim+Não, 1X2 duplicado), e cobertura dos jogos das próximas 24h. Use para responder perguntas sobre integridade/estado geral do sistema.",
    parameters: {},
  },
  {
    name: "listar_conflitos",
    description:
      "Lista os conflitos atuais de palpites: no MESMO jogo, mercados opostos publicados na Triagem ou seleções opostas dentro de um bilhete de auto_tickets (ex.: Under 1.5 + Over 1.5, Ambas \u201cSim\u201d + Ambas \u201cN\u00e3o\u201d, 1X2 com dois palpites). Retorna fixture_id e os lados em conflito.",
    parameters: {},
  },
  {
    name: "cobertura_24h",
    description:
      "Cobertura das próximas 24h: quantos jogos já têm selo/mercado publicado na Triagem, quantos bilhetes estão pending ou skipped em auto_tickets. Use para responder \u201cos jogos das próximas 24h est\u00e3o prontos?\u201d.",
    parameters: {},
  },
  {
    name: "ranking_markets",
    description:
      "Ranking de assertividade por mercado (emissor de bilhetes): acertos percentuais e volume de cada mercado da IA. Use para responder perguntas de desempenho por mercado.",
    parameters: {},
  },
];

function toJson(v: unknown): string {
  return JSON.stringify(v);
}

/** Executa uma tool da lista de forma SEGURA (apenas as permitidas acima). */
export async function runAssistantTool(
  name: string,
  _args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "auditoria_completa": {
      const { auditoriaCompleta } = await import("./auditoria.server");
      return toJson(await auditoriaCompleta());
    }
    case "listar_conflitos": {
      const { auditoriaCompleta } = await import("./auditoria.server");
      const a = await auditoriaCompleta();
      return toJson({
        timestamp: a.timestamp,
        conflitos: a.conflitos,
        conflitos_por_tipo: a.conflitos_por_tipo,
      });
    }
    case "cobertura_24h": {
      const { auditoriaCompleta } = await import("./auditoria.server");
      const a = await auditoriaCompleta();
      return toJson({ timestamp: a.timestamp, cobertura_24h: a.resumo.cobertura_24h });
    }
    case "ranking_markets": {
      const { getPlatformSnapshotRaw } = await import("./diagnostics.server");
      const s = await getPlatformSnapshotRaw();
      return toJson({ timestamp: new Date().toISOString(), markets: s.markets });
    }
    default:
      return JSON.stringify({ error: `Tool desconhecida: ${name}` });
  }
}