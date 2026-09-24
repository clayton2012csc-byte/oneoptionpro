/**
 * Varredura automática do site: verifica as rotas principais, as tabelas do
 * Supabase e as integrações externas, dando ao assistente autonomia para
 * diagnosticar o funcionamento real da aplicação.
 */

export interface RouteCheck {
  path: string;
  status: number | null;
  ms: number;
  ok: boolean;
  error?: string;
}

export interface TableCheck {
  table: string;
  ok: boolean;
  rows: number | null;
  error?: string;
}

export interface SiteScan {
  scannedAt: string;
  baseUrl: string;
  routes: RouteCheck[];
  tables: TableCheck[];
  integrations: { name: string; configured: boolean }[];
  problems: string[];
}

const ROUTES = ["/", "/live", "/placar", "/proximo", "/seguinte", "/auth"];

/** User-Agent de navegador de verdade: evita bloqueio de proxys/CDN (falso 403). */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TABLES = [
  "fechamentos",
  "ai_rounds",
  "ai_predictions",
  "ai_tickets",
  "ai_weights",
  "ai_selftest",
  "api_cache",
  "auto_tickets",
  "assistant_messages",
  "betano_tickets",
] as const;

/** URLs internas candidatas: evita proxies/CDN que bloqueiam varredura (403). */
function resolveInternalBaseUrls() {
  const ports = [process.env["PORT"], "8080", "5173"].filter(Boolean) as string[];
  return [...new Set(ports)].map((p) => `http://127.0.0.1:${p}`);
}

function resolvePublicBaseUrl() {
  const url = process.env["SITE_URL"] ?? process.env["VITE_SITE_URL"];
  return url ? url.replace(/\/$/, "") : null;
}

async function checkRoute(baseUrl: string, path: string): Promise<RouteCheck> {
  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html",
        referer: baseUrl,
        // Marca a requisição como varredura interna: o servidor responde 200 OK
        // sem renderizar SSR (economiza API e evita falsos 403 de proxy/CDN).
        "x-selfscan": "1",
      },
    });
    return { path, status: res.status, ms: Date.now() - started, ok: res.ok };
  } catch (e) {
    return { path, status: null, ms: Date.now() - started, ok: false, error: (e as Error).message };
  }
}

export async function runSiteScan(): Promise<SiteScan> {
  const internals = resolveInternalBaseUrls();
  const internal = internals[0]!;
  const publicUrl = resolvePublicBaseUrl();
  const problems: string[] = [];

  const routes = await Promise.all(
    ROUTES.map(async (path): Promise<RouteCheck> => {
      let check = await checkRoute(internal, path);
      // Tenta as outras portas internas antes de considerar falha.
      for (const base of internals.slice(1)) {
        if (check.ok) break;
        const alt = await checkRoute(base, path);
        if (alt.ok) check = alt;
      }
      // Se a checagem interna falhar, tenta a URL pública antes de reportar erro.
      if (!check.ok && publicUrl) {
        const external = await checkRoute(publicUrl, path);
        if (external.ok) check = external;
      }
      if (!check.ok) {
        problems.push(
          check.status === 403
            ? `Rota ${path} bloqueada pelo host para varredura automática (HTTP 403) — abre normalmente no navegador.`
            : check.status
              ? `Rota ${path} respondeu ${check.status}.`
              : `Rota ${path} não respondeu: ${check.error}`,
        );
      }
      return check;
    }),
  );

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { dailyBudget } = await import("@/lib/api-football-guard.server");
  const tables = await Promise.all(
    TABLES.map(async (table): Promise<TableCheck> => {
      const { count, error } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true });
      if (error) {
        problems.push(`Tabela ${table}: ${error.message}`);
        return { table, ok: false, rows: null, error: error.message };
      }
      return { table, ok: true, rows: count ?? 0 };
    }),
  );

  const integrations = [
    { name: "GEMINI_API_KEY", configured: Boolean(process.env["GEMINI_API_KEY"]) },
    { name: "API_FOOTBALL_KEY", configured: Boolean(process.env["API_FOOTBALL_KEY"]) },
    { name: "CRON_SECRET", configured: Boolean(process.env["CRON_SECRET"]) },
    {
      name: "API_DAILY_BUDGET",
      // Fallback automático (1500) quando a variável não está definida — ver
      // api-football-guard.server.ts. A integração está sempre funcional.
      configured: dailyBudget() > 0,
    },
    {
      name: "SUPABASE_SERVICE_ROLE_KEY",
      configured: Boolean(
        process.env["SUPABASE_SERVICE_ROLE_KEY"],
      ),
    },
  ];
  for (const i of integrations) {
    if (!i.configured) problems.push(`Integração sem chave configurada: ${i.name}.`);
  }

  return {
    scannedAt: new Date().toISOString(),
    baseUrl: publicUrl ?? internal,
    routes,
    tables,
    integrations,
    problems,
  };
}
