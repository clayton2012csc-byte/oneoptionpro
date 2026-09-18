/**
 * Provedor de IA do app: Google Gemini (chave própria do usuário).
 * Todas as chamadas de IA passam por aqui.
 */

export interface ChatAttachment {
  name: string;
  mime: string;
  /** data URL base64 */
  dataUrl: string;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
}

export const getGeminiModel = () => process.env["GEMINI_MODEL"] ?? "gemini-3.6-flash";

function requireKey() {
  const key = process.env["GEMINI_API_KEY"];
  if (!key) throw new Error("IA indisponível: configure a variável GEMINI_API_KEY.");
  return key;
}

function toParts(msg: ChatMessage) {
  const parts: Record<string, unknown>[] = [{ text: msg.content }];
  for (const a of msg.attachments ?? []) {
    const base64 = a.dataUrl.includes(",") ? a.dataUrl.split(",")[1]! : a.dataUrl;
    const mimeType = a.mime.split(";")[0] || "application/octet-stream";
    parts.push({ inlineData: { mimeType, data: base64 } });
  }
  return parts;
}

/** Chamada de texto ao Gemini. `system` são instruções de sistema (concatenadas). */
/** Modelos alternativos usados quando o principal está sobrecarregado (503/404). */
const FALLBACK_MODELS = ["gemini-flash-latest"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geminiChat(opts: {
  system: string[];
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Força a resposta como JSON (responseMimeType application/json). */
  json?: boolean;
  /**
   * Orçamento de raciocínio interno do Gemini 3. O padrão 0 desliga o "thinking",
   * que sozinho fazia respostas simples levarem mais de 100s (o chat parecia travado).
   */
  thinkingBudget?: number;
  /** Tempo máximo por tentativa (ms). */
  timeoutMs?: number;
}): Promise<string> {
  const models = [...new Set([getGeminiModel(), ...FALLBACK_MODELS])];
  let lastError: Error | null = null;

  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callGemini(model, opts);
      } catch (e) {
        lastError = e as Error;
        if (!/\[(404|429|5\d\d)\]|Muitas requisições|abort|timeout|tempo limite/i.test(lastError.message))
          throw lastError;
        if (/\[404\]/.test(lastError.message)) break; // modelo inexistente: tenta o próximo
        await sleep(1200 * (attempt + 1));
      }
    }
  }
  throw new Error(
    `A IA está temporariamente sobrecarregada. Tente novamente em instantes. (${lastError?.message ?? ""})`.trim(),
  );
}


async function callGemini(
  model: string,
  opts: {
    system: string[];
    messages: ChatMessage[];
    temperature?: number;
    maxOutputTokens?: number;
    json?: boolean;
    thinkingBudget?: number;
    timeoutMs?: number;
  },
): Promise<string> {
  const key = requireKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: opts.system.filter(Boolean).map((text) => ({ text })) },
          contents: opts.messages.map((m) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: toParts(m),
          })),
          generationConfig: {
            temperature: opts.temperature ?? 0.6,
            maxOutputTokens: opts.maxOutputTokens ?? 2048,
            thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
            ...(opts.json ? { responseMimeType: "application/json" } : {}),
          },
        }),
      },
    );
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "tempo limite excedido" : (e as Error).message;
    throw new Error(`Falha na IA [504]: ${msg}`);
  } finally {
    clearTimeout(timer);
  }


  if (!res.ok) {
    const body = await res.text();
    if (res.status === 429) throw new Error("Muitas requisições ao Gemini. Tente em instantes.");
    if (res.status === 403 || res.status === 401)
      throw new Error("Chave do Gemini inválida ou sem permissão. Verifique GEMINI_API_KEY.");
    throw new Error(`Falha na IA [${res.status}]: ${body.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("A IA não retornou uma resposta válida.");
  return text;
}

/**
 * Versão em streaming (SSE) do Gemini: entrega o texto em pedaços conforme o
 * modelo escreve. Evita a sensação de "travado" em respostas longas.
 */
export async function* geminiStream(opts: {
  system: string[];
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  thinkingBudget?: number;
}): AsyncGenerator<string> {
  const key = requireKey();
  const models = [...new Set([getGeminiModel(), ...FALLBACK_MODELS])];
  let res: Response | null = null;
  let lastStatus = 0;
  let lastBody = "";
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await openStream(model, key, opts);
      if (r.ok && r.body) {
        res = r;
        break;
      }
      lastStatus = r.status;
      lastBody = await r.text().catch(() => "");
      if (r.status !== 429 && r.status < 500) break;
      await sleep(2000 * (attempt + 1));
    }
    if (res) break;
  }

  if (!res || !res.body) {
    if (lastStatus === 429)
      throw new Error(
        "A chave do Gemini atingiu o limite de uso do momento. Aguarde cerca de 1 minuto e envie de novo.",
      );
    if (lastStatus === 401 || lastStatus === 403)
      throw new Error("Chave do Gemini inválida ou sem permissão. Verifique GEMINI_API_KEY.");
    throw new Error(`Falha na IA [${lastStatus}]: ${lastBody.slice(0, 200)}`);
  }

  yield* readStream(res);
}

function openStream(
  model: string,
  key: string,
  opts: {
    system: string[];
    messages: ChatMessage[];
    temperature?: number;
    maxOutputTokens?: number;
    thinkingBudget?: number;
  },
) {
  return fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: opts.system.filter(Boolean).map((text) => ({ text })) },
        contents: opts.messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: toParts(m),
        })),
        generationConfig: {
          temperature: opts.temperature ?? 0.6,
          maxOutputTokens: opts.maxOutputTokens ?? 2048,
          thinkingConfig: { thinkingBudget: opts.thinkingBudget ?? 0 },
        },
      }),
    },
  );
}



async function* readStream(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const chunk = (json.candidates?.[0]?.content?.parts ?? [])
          .map((p) => p.text ?? "")
          .join("");
        if (chunk) yield chunk;
      } catch {
        /* pedaço incompleto: ignora */
      }
    }
  }
}
