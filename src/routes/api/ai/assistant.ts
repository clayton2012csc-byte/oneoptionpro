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
        content: z.string().min(1).max(6000),
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
        const { geminiStream } = await import("@/lib/ai-provider.server");
        const { getPlatformSnapshotRaw } = await import("@/lib/diagnostics.server");
        const { runSiteScan } = await import("@/lib/site-scan.server");

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              const [snapshot, scan] = await Promise.all([
                getPlatformSnapshotRaw(),
                runSiteScan(),
              ]);
              for await (const chunk of geminiStream({
                system: [
                  ASSISTANT_SYSTEM,
                  `SNAPSHOT REAL DO BANCO (JSON):\n${JSON.stringify(snapshot)}`,
                  `VARREDURA AO VIVO DO SITE (JSON):\n${JSON.stringify(scan)}`,
                ],
                messages: parsed.data.messages,
                maxOutputTokens: 8000,
                thinkingBudget: 0,
              })) {
                controller.enqueue(encoder.encode(chunk));
              }
            } catch (e) {
              controller.enqueue(
                encoder.encode(`\n\n**Erro:** ${(e as Error).message}`),
              );
            } finally {
              controller.close();
            }
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
      },
    },
  },
});
