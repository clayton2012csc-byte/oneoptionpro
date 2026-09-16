import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

/**
 * Rotas verificadas pela varredura automática (healthcheck interno).
 * Chamadas marcadas com `x-selfscan: 1` são respondidas direto com 200 OK,
 * sem renderizar SSR — evita gasto de API e falsos 403 de proxy/CDN.
 */
const HEALTHCHECK_PATHS = new Set(["/", "/live", "/placar", "/proximo", "/seguinte", "/auth"]);
const HEALTHCHECK_HEADER = "x-selfscan";
const HEALTHCHECK_TOKEN = "1";

function isVisiblePath(path: string): boolean {
  return HEALTHCHECK_PATHS.has(path.split("?")[0]);
}

function healthcheckResponse(path: string): Response {
  return new Response(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>One OptiOn IA</title></head><body>ok:${path}</body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, OPTIONS",
        "access-control-allow-headers": "content-type, authorization, x-cron-secret, x-selfscan",
      },
    },
  );
}

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      const isProbe =
        request.method === "GET" &&
        request.headers.get(HEALTHCHECK_HEADER) === HEALTHCHECK_TOKEN &&
        isVisiblePath(url.pathname);
      if (isProbe) return healthcheckResponse(url.pathname);

      // Preflight de CORS para as rotas públicas de conteúdo (GET).
      if (request.method === "OPTIONS" && isVisiblePath(url.pathname)) {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": "*",
            "access-control-allow-methods": "GET, OPTIONS",
            "access-control-allow-headers": "content-type, authorization, x-cron-secret, x-selfscan",
            "access-control-max-age": "86400",
          },
        });
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
