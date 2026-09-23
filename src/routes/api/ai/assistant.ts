/**
 * Chat do Assistente IA em streaming: devolve o texto em pedaços conforme o
 * modelo escreve, para o painel nunca ficar parado em "Analisando...".
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(20000),
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
});

export const Route = createFileRoute("/api/ai/assistant")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = Body.safeParse(await request.json());
        if (!parsed.success) return new Response("Payload inválido", { status: 400 });

        const { ASSISTANT_SYSTEM } = await import("@/lib/assistant-prompt");
        const { geminiChat, geminiChatWithTools } = await import("@/lib/ai-provider.server");
        const { getPlatformSnapshotRaw } = await import("@/lib/diagnostics.server");
        const { runSiteScan } = await import("@/lib/site-scan.server");
        const { ASSISTANT_TOOLS, runAssistantTool } = await import("@/lib/assistant-tools.server");

        const [snapshot, scan] = await Promise.all([getPlatformSnapshotRaw(), runSiteScan()]);
        const system = [
          ASSISTANT_SYSTEM,
          `SNAPSHOT REAL DO BANCO (JSON):\n${JSON.stringify(snapshot)}`,
          `VARREDURA AO VIVO DO SITE (JSON):\n${JSON.stringify(scan)}`,
        ];

        let answer: string;
        try {
          answer = await geminiChatWithTools({
            system,
            messages: parsed.data.messages,
            tools: ASSISTANT_TOOLS,
            runTool: runAssistantTool,
            maxOutputTokens: 8000,
            thinkingBudget: 0,
          });
        } catch (toolErr) {
          console.warn("[assistant] tool-call falhou, usando resposta direta:", (toolErr as Error).message);
          answer = await geminiChat({
            system,
            messages: parsed.data.messages,
            maxOutputTokens: 8000,
            thinkingBudget: 0,
            timeoutMs: 120_000,
          });
        }

        return new Response(answer, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      },
    },
  },
});
