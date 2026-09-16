// Pipeline de "mercados complexos" via Gemini: âncoras Poisson injetadas no
// prompt, prompt que exige JSON estruturado dependente, validação cruzada
// (applyComplexRules) antes de gravar em ai_predictions e bloqueio em
// divergência. Server-side apenas.

import {
  applyComplexRules,
  deriveFromScoreline,
  favoriteHtMode,
  favoriteOf,
  makeAdversarial,
  pickProbs,
  scorelineAnchors,
  COMPLEX_MARKETS,
} from "./complex-markets";
import type {
  AmbasMarcam,
  ComplexPickSet,
  Resultado1x2,
  ScoreAnchor,
} from "./complex-markets";
import { computeOwnPrediction, type OwnPrediction } from "./own-prediction";
import { getFixture, getFixturesByDate, getMatchPreview } from "./api-football.functions";
import type { ApiFixture } from "./api-football.functions";

const TZ = "America/Sao_Paulo";
const SP_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface FixtureRef {
  id: number;
  homeId: number;
  awayId: number;
  homeName?: string;
  awayName?: string;
  leagueName?: string;
  round?: string;
}

const SYSTEM_PROMPT = [
  "Você é um analista de apostas esportivas de elite (OneOption).",
  "Você recebe probabilidades Poisson/Dixon-Coles já calculadas por um modelo e deve produzir UM cenário de mercado totalmente coerente.",
  "Responda APENAS com um JSON válido (sem markdown, sem explicações) com EXATAMENTE estas 5 chaves e valores restritos:",
  '{ "placar_exato_seco": "X-Y", "margem_vitoria": "Casa por N" | "Fora por N" | "Empate", "ambas_marcam": "Sim" | "Não", "resultado_1x2": "1" | "X" | "2", "evolucao_jogo": "HT/FT" }.',
  "Regras LÓGICAS obrigatórias (nunca viole):",
  "1) margem_vitoria DEVE ser o módulo |X-Y| do placar_exato_seco: \"Casa por N\", \"Fora por N\" ou \"Empate\".",
  '2) Se o placar for empate (X=Y), resultado_1x2 DEVE ser "X" e ambas_marcam DEVE ser "Sim" (exceto 0-0, onde ambas_marcam é "Não").',
  '3) O "FT" de evolucao_jogo (o código após a barra) DEVE ser idêntico a resultado_1x2. O "HT" (antes da barra) indica quem liderava no 1º tempo ("1", "X" ou "2").',
  "Use as âncoras de maior probabilidade como referência para escolher o placar_exato_seco, mas mantenha coerência total entre as 5 chaves.",
  "IMPORTANTE: A resposta DEVE conter APENAS o JSON (sem frases, sem listas, sem explicação antes ou depois).",
].join("\n");

function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

function anchorsText(anchors: ScoreAnchor[]): string {
  return anchors.map((a, i) => `${i + 1}) ${a.label} (${pct(a.p)})`).join(" | ");
}

function buildUserPrompt(
  ref: FixtureRef,
  pred: OwnPrediction,
  favSide: "home" | "away",
  favHt: Resultado1x2,
  anchors: ScoreAnchor[],
): string {
  const home = ref.homeName ?? `Mandante #${ref.homeId}`;
  const away = ref.awayName ?? `Visitante #${ref.awayId}`;
  const favorite = favSide === "home" ? home : away;
  const ht1 = pct(pred.htHome);
  const htx = pct(pred.htDraw);
  const ht2 = pct(pred.htAway);

  return [
    `Jogo: ${home} vs ${away}${ref.leagueName ? ` — ${ref.leagueName}` : ""}${ref.round ? ` (rodada ${ref.round})` : ""}`,
    `Modelo Poisson/Dixon-Coles: λ casa ${pred.lambdaHome} · λ fora ${pred.lambdaAway} · gols esperados ${pred.expectedGoals}.`,
    `Probabilidades 1X2: Casa ${pct(pred.pHome)}% · Empate ${pct(pred.pDraw)}% · Fora ${pct(pred.pAway)}%.`,
    `Ambas Marcam: Sim ${pct(pred.pBTTS)}% · Não ${pct(pred.pNoBTTS)}%.`,
    `Placares mais prováveis (âncoras): ${anchorsText(anchors)}.`,
    `Favorito: ${favorite}. Perfil de 1º tempo do favorito: 1 ${ht1} · X ${htx} · 2 ${ht2}; HT/FT mais provável: "${favHt}".`,
    "Preencha EXATAMENTE este esqueleto (sem texto):",
    `{ "placar_exato_seco": "X-Y", "margem_vitoria": "Casa por N", "ambas_marcam": "Sim", "resultado_1x2": "1", "evolucao_jogo": "${favHt}/1" }`,
  ].join("\n");
}

function asR1x2(v: unknown): Resultado1x2 | null {
  if (typeof v !== "string") return null;
  const u = v.toUpperCase();
  const m = u.trim().match(/^(1|X|2)\b/);
  if (m) return m[1] as Resultado1x2;
  if (u.includes("EMPATE")) return "X";
  if (u.includes("CASA") || u.includes("MANDANTE") || u.includes("VITORIA")) return "1";
  if (u.includes("FORA") || u.includes("VISITANTE")) return "2";
  return null;
}

function asAmbas(v: unknown): AmbasMarcam | null {
  if (typeof v === "boolean") return v ? "Sim" : "Não";
  if (typeof v !== "string") return null;
  const u = v.toUpperCase().replace(/[^A-Z]/g, "");
  if (u === "SIM" || u === "S" || u === "YES" || u === "Y" || u === "TRUE") return "Sim";
  if (u === "NAO" || u === "NO" || u === "N" || u === "FALSE") return "Não";
  return null;
}

function sanitizePickSet(raw: unknown): ComplexPickSet | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.placar_exato_seco !== "string" ||
    typeof o.margem_vitoria !== "string" ||
    typeof o.evolucao_jogo !== "string"
  ) {
    return null;
  }
  const resultado_1x2 = asR1x2(o.resultado_1x2);
  const ambas_marcam = asAmbas(o.ambas_marcam);
  if (!resultado_1x2 || !ambas_marcam) return null;
  return {
    placar_exato_seco: o.placar_exato_seco.trim(),
    margem_vitoria: o.margem_vitoria.trim(),
    ambas_marcam,
    resultado_1x2,
    evolucao_jogo: o.evolucao_jogo.trim().toUpperCase(),
  };
}

function scanJson(text: string, from = 0): { block: string; end: number } | null {
  const start = text.indexOf("{", from);
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (c === "\\") {
      esc = true;
      continue;
    }
    if (c === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return { block: text.slice(start, i + 1), end: i + 1 };
    }
  }
  return null;
}

function extractJson(text: string): ComplexPickSet | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  let from = 0;
  for (;;) {
    const found = scanJson(candidate, from);
    if (!found) break;
    from = found.end;
    try {
      const parsed = JSON.parse(found.block) as unknown;
      const picked = sanitizePickSet(parsed);
      if (picked) return picked;
    } catch {
      // continua procurando o próximo bloco
    }
  }
  const greedy = candidate.match(/\{[\s\S]*\}/)?.[0];
  if (greedy) {
    try {
      const parsed = JSON.parse(greedy) as unknown;
      return sanitizePickSet(parsed);
    } catch {
      return null;
    }
  }
  return null;
}

function spDate(offsetDays: number): string {
  const d = new Date(Date.now() - offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export async function pickFinishedFixtures(limit: number, daysBack = 3): Promise<ApiFixture[]> {
  const out: ApiFixture[] = [];
  const required = limit * 4;
  for (let off = 1; off <= daysBack && out.length < required; off++) {
    const date = spDate(off);
    if (!SP_DATE_RE.test(date)) break;
    const fixtures = (await getFixturesByDate({ data: { date } })) as ApiFixture[];
    for (const f of fixtures) {
      const short = f.fixture.status.short;
      const finished = short === "FT" || short === "AET" || short === "PEN";
      if (!finished) continue;
      const gh = f.goals.home ?? 0;
      const ga = f.goals.away ?? 0;
      if (gh === 0 && ga === 0 && !f.goals.home && !f.goals.away) continue;
      out.push(f);
      if (out.length >= required) break;
    }
  }
  return out.slice(0, limit * 3);
}

async function loadPrediction(ref: FixtureRef) {
  const preview = await getMatchPreview({ data: { homeId: ref.homeId, awayId: ref.awayId, last: 3 } });
  if (!preview) return null;
  const pred = computeOwnPrediction(preview.home, preview.away);
  if (!pred.ready || pred.topScores.length === 0) return null;
  return pred;
}

export async function runComplexMarketsDryRun(
  fixtures: FixtureRef[],
  limit: number,
): Promise<Record<string, unknown>> {
  const report: { fixtureId: number; home: string; away: string; topAnchor: string; coherent: boolean }[] = [];
  let queried = 0;
  let adversarialSimulated = 0;
  let adversarialBlocked = 0;

  for (const ref of fixtures) {
    if (report.length >= limit) break;
    queried++;
    const pred = await loadPrediction(ref);
    if (!pred) continue;

    const ht = favoriteHtMode(pred);
    const anchors = scorelineAnchors(pred, 1);
    const top = anchors[0]!;
    const derived = deriveFromScoreline(top.home, top.away, ht);
    const val = applyComplexRules(derived, { favoriteHt: ht });
    const coherent = val.ok;

    for (const bad of makeAdversarial(derived)) {
      adversarialSimulated++;
      if (!applyComplexRules(bad, { favoriteHt: ht }).ok) adversarialBlocked++;
    }

    report.push({
      fixtureId: ref.id,
      home: ref.homeName ?? `#${ref.homeId}`,
      away: ref.awayName ?? `#${ref.awayId}`,
      topAnchor: top.label,
      coherent,
    });
  }

  const coherentCount = report.filter((r) => r.coherent).length;
  return {
    mode: "dry-run",
    tested: report.length,
    coherent: coherentCount,
    coherenceRate: report.length > 0 ? (coherentCount / report.length) * 100 : 0,
    adversarialSimulated,
    adversarialBlocked,
    adversarialBlockRate: adversarialSimulated > 0 ? (adversarialBlocked / adversarialSimulated) * 100 : 0,
    queried,
    fixtures: report,
  };
}

export async function analyzeComplexMarketsLive(
  fixtures: FixtureRef[],
  limit: number,
): Promise<Record<string, unknown>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { geminiChat } = await import("./ai-provider.server");

  const results: Record<string, unknown>[] = [];
  const analyzed = fixtures.slice(0, limit);

  for (const ref of analyzed) {
    try {
      const fixture = ref.homeName
        ? null
        : await getFixture({ data: { id: ref.id } });
      const homeName = ref.homeName ?? fixture?.teams.home.name ?? `Mandante #${ref.homeId}`;
      const awayName = ref.awayName ?? fixture?.teams.away.name ?? `Visitante #${ref.awayId}`;
      const leagueName = ref.leagueName ?? fixture?.league.name;
      const round = ref.round ?? fixture?.league.round;

      const pred = await loadPrediction(ref);
      if (!pred) {
        results.push({ fixtureId: ref.id, blocked: true, issue: "Sem dados suficientes para o modelo Poisson." });
        continue;
      }

      const anchors = scorelineAnchors(pred, 3);
      const favSide = favoriteOf(pred);
      const favHt = favoriteHtMode(pred);

      const text = await geminiChat({
        system: [SYSTEM_PROMPT],
        messages: [{ role: "user", content: buildUserPrompt({ ...ref, homeName, awayName, leagueName, round }, pred, favSide, favHt, anchors) }],
        temperature: 0.2,
        maxOutputTokens: 1024,
        json: true,
      });

      const picks = extractJson(text);
      if (!picks) {
        results.push({
          fixtureId: ref.id,
          blocked: true,
          issue: "Gemini não retornou JSON válido.",
          raw: text.slice(0, 800),
        });
        continue;
      }

      const val = applyComplexRules(picks, { favoriteHt: favHt });
      if (!val.ok) {
        results.push({
          fixtureId: ref.id,
          blocked: true,
          issues: val.issues,
          corrected: val.corrected,
          picks: val.derived,
        });
        continue;
      }

      const probs = pickProbs(pred, picks);
      const rows = COMPLEX_MARKETS.map((market) => ({
        fixture_id: ref.id,
        market,
        probability: Number(Math.max(0.0001, probs[market]).toFixed(4)),
        score: Math.min(100, Math.max(0, Math.round(probs[market] * 100))),
        features: {
          pick_set: picks,
          anchors,
          favorite_side: favSide,
          favorite_ht: favHt,
          lambda_home: pred.lambdaHome,
          lambda_away: pred.lambdaAway,
          source: "gemini-complex",
        },
        vetoed: false,
      }));

      await supabaseAdmin.from("ai_predictions").insert(rows as never);

      results.push({
        fixtureId: ref.id,
        blocked: false,
        inserted: rows.length,
        markets: rows.map((r) => r.market),
      });
    } catch (e) {
      results.push({
        fixtureId: ref.id,
        blocked: true,
        issue: (e as Error).message,
      });
    }
  }

  const inserted = results.filter((r) => !r.blocked).length;
  return {
    mode: "live",
    analyzed: results.length,
    insertedFixtures: inserted,
    blockedFixtures: results.length - inserted,
    fixtures: results,
  };
}