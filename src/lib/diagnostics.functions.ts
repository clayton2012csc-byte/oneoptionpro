/**
 * Assistente IA de Diagnóstico & Melhorias.
 * Lê o estado real da plataforma no banco e conversa com o modelo para gerar
 * o diagnóstico + o prompt técnico pronto para copiar para onde quiser.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Varredura completa do site (rotas, tabelas e integrações). */
export const scanSite = createServerFn({ method: "GET" }).handler(async () => {
  const { runSiteScan } = await import("./site-scan.server");
  return await runSiteScan();
});


export type { PlatformSnapshot } from "./diagnostics.server";

/** Raio-X do banco: bilhetes, cobertura, assertividade por mercado, cache e rodadas. */
export const getPlatformSnapshot = createServerFn({ method: "GET" }).handler(async () => {
  const { getPlatformSnapshotRaw } = await import("./diagnostics.server");
  return await getPlatformSnapshotRaw();
});

const SYSTEM = `Você é o "Engenheiro de IA Residente" do OneOptionIA — um app TanStack Start + Supabase de análise de futebol.
Contexto do produto: abas Dashboard Clayton, Bingão (Under 1.5, Prova Real, 4 jogos), Lotéca IA, Radar, Beta, Alfha, Artilheiros, Especiais Betano, Triagem (9 mercados) e Bilhetes Auto (robô de 11 mercados salvos na tabela auto_tickets, com conferência automática e ranking de assertividade).
Você recebe, a cada mensagem, um SNAPSHOT REAL do banco e uma VARREDURA AO VIVO do site (rotas testadas com status e tempo, tabelas do Supabase acessíveis e contagem de linhas, integrações configuradas). Use SOMENTE esses dados ao falar de estado atual — nunca invente métricas.

Você tem AUTONOMIA TOTAL dentro do site: diagnosticar, discutir ideias, propor e detalhar novas funções, revisar regras de mercado e escrever o passo a passo técnico da implementação. Nunca responda "não posso" — sempre entregue análise + caminho prático. Se o usuário anexar print/vídeo/áudio, leia o anexo e responda sobre ele.

Escolha o modo pela pergunta:

1) MODO DIAGNÓSTICO (quando o usuário relata erro/queda/dúvida sobre o funcionamento):
## Diagnóstico — 2 a 5 bullets com números do snapshot e a causa provável.
## Verificação de integridade — o que está saudável e o que está degradado.
## Prompt técnico pronto — um bloco \`\`\`text com instrução executável (arquivos prováveis, regras, critérios de aceite).

2) MODO PLANO DE NOVA FUNÇÃO (quando o usuário pede/discute uma funcionalidade nova, como novos bilhetes, níveis de odds, destaques na tela):
## Entendi assim — 2 bullets reformulando o pedido em uma frase clara cada.
## Como funciona — regras de negócio numeradas (filtros, faixas de odds, quantidade, quando recria, onde aparece na tela).
## Impacto no banco e na API — tabelas/campos novos e custo de requisições.
## Plano de implementação — passos numerados e curtos.
## Prompt técnico pronto — bloco \`\`\`text autossuficiente para executar a implementação.
Termine com 1 pergunta objetiva para fechar a decisão que faltou.

3) MODO CONVERSA (pergunta livre): responda direto, curto e útil, sem forçar formato.

Responda SEMPRE em português do Brasil simples, direto, sem enrolação e sem repetir o snapshot cru.`;


export const diagnosticChat = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      messages: z
        .array(
          z.object({
            role: z.enum(["user", "assistant"]),
            content: z.string().min(1).max(6000),
            /** Anexos (prints, imagens, PDFs, vídeos ou áudios) em data URL base64. */
            attachments: z
              .array(
                z.object({
                  name: z.string().max(200),
                  mime: z.string().max(100),
                  dataUrl: z.string().max(28_000_000),
                }),
              )
              .max(4)
              .optional(),
          }),
        )
        .min(1)
        .max(24),
    }),
  )
  .handler(async ({ data }) => {
    const { geminiChat } = await import("./ai-provider.server");
    const { getPlatformSnapshotRaw } = await import("./diagnostics.server");
    const { runSiteScan } = await import("./site-scan.server");
    const [snapshot, scan] = await Promise.all([getPlatformSnapshotRaw(), runSiteScan()]);

    const text = await geminiChat({
      system: [
        SYSTEM,
        `SNAPSHOT REAL DO BANCO (JSON):\n${JSON.stringify(snapshot)}`,
        `VARREDURA AO VIVO DO SITE (JSON):\n${JSON.stringify(scan)}`,
      ],
      messages: data.messages.map((m) => ({
        role: m.role,
        content: m.content,
        attachments: m.attachments,
      })),
      maxOutputTokens: 1400,
      thinkingBudget: 0,
      timeoutMs: 100_000,

    });
    return { text, snapshot, scan };
  });


/* ------------------------------------------------------------------ *
 * Histórico permanente do chat (tabela assistant_messages)            *
 * ------------------------------------------------------------------ */

export const listChatMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("assistant_messages")
      .select("id, role, content, created_at")
      .order("created_at", { ascending: true })
      .limit(400);
    if (error) throw new Error(error.message);
    return (data ?? []) as { id: string; role: "user" | "assistant"; content: string; created_at: string }[];
  });

export const saveChatTurn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      messages: z
        .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(20000) }))
        .min(1)
        .max(4),
    }),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("assistant_messages")
      .insert(data.messages.map((m) => ({ ...m, user_id: context.userId })));
    if (error) throw new Error(error.message);
    return { saved: data.messages.length };
  });

export const clearChatMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("assistant_messages")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Mensagem de abertura: o assistente lê o banco e se apresenta dizendo o que
 * encontrou, cruzando com o mapa das abas/estratégias do site.
 */
export const introMessage = createServerFn({ method: "GET" }).handler(async () => {
  const { getPlatformSnapshotRaw } = await import("./diagnostics.server");
  const { runSiteScan } = await import("./site-scan.server");
  const { geminiChat } = await import("./ai-provider.server");
  const [snapshot, scan] = await Promise.all([getPlatformSnapshotRaw(), runSiteScan()]);

  const text = await geminiChat({
    system: [
      SYSTEM,
      `SNAPSHOT REAL DO BANCO (JSON):\n${JSON.stringify(snapshot)}`,
      `VARREDURA AO VIVO DO SITE (JSON):\n${JSON.stringify(scan)}`,
    ],
    messages: [
      {
        role: "user",
        content:
          "Esta é a abertura da sessão. Ignore o formato padrão de diagnóstico e responda assim:\n" +
          "## Mapeamento do sistema\nBullets curtos mostrando que você leu o banco AGORA: cobertura das próximas 24h (prontos/skipped/pendentes), assertividade global, os 3 melhores e os 3 piores mercados com % e volume, estado do cache e das últimas rodadas, snapshots de varredura.\n" +
          "## Varredura do site\nBullets com o resultado real da varredura: rotas que responderam ou falharam (com tempo), tabelas acessíveis e com quantas linhas, integrações sem chave.\n" +
          "## Leitura das abas\n1 bullet por área relevante (Dashboard Clayton, Bingão Prova Real, Lotéca IA, Radar, Beta, Alfha, Artilheiros, Especiais Betano, Bilhetes Auto) dizendo como ela está sendo afetada pelos números acima.\n" +
          "## O que atacamos agora?\n3 sugestões numeradas de otimização priorizadas pelo impacto, e termine perguntando o que eu quero analisar ou otimizar.\n" +
          "NÃO gere bloco de prompt nesta mensagem.",
      },
    ],
    maxOutputTokens: 1200,
    thinkingBudget: 0,
    timeoutMs: 90_000,

  });
  return { text, snapshot, scan };

});
