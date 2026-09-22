/**
 * Triagem como fonte de verdade nos cards/selos de TODAS as abas.
 * Carrega as avaliações da Triagem (9 mercados) por fixture e entrega a
 * qualquer componente (AiPickBadges, ProbabilityBadge) — zero custo de API,
 * apenas leitura de triagem_records.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { useServerFn } from "@tanstack/react-start";
import { getTriagemByFixtures, getProximas24hSelos } from "./triagem.functions";
import { MIN_SCORE, MIN_SCORE_BY_MARKET } from "./triagem-engine";

export interface TriagemMarketBadge {
  market_type: string;
  label: string;
  selection: string;
  probability: number;
  score: number;
  passed: boolean;
  status: "pending" | "green" | "red" | "void";
}

export interface TriagemFixtureView {
  fixtureId: number;
  matchName: string;
  markets: TriagemMarketBadge[];
}

interface TriagemViewState {
  byFixture: Record<number, TriagemFixtureView>;
  hydrate: (views: TriagemFixtureView[]) => void;
}

export const useTriagemView = create<TriagemViewState>((set) => ({
  byFixture: {},
  hydrate: (views) =>
    set((s) => {
      const next = { ...s.byFixture };
      for (const v of views) next[v.fixtureId] = v;
      return { byFixture: next };
    }),
}));

/** Em voo + já carregados: evita disparar a mesma leitura dezenas de vezes. */
const requested = new Set<number>();

/**
 * Busca a triagem de um lote de ids e injeta no store — zero API-Football,
 * apenas leitura de triagem_records. Dedupe por id para não refazer consultas.
 * Refaz quando o conjunto de ids muda (ex.: varredura adiciona jogos novos).
 */
export function useTriagemSync(ids: number[]) {
  const sync = useServerFn(getTriagemByFixtures);
  const hydrate = useTriagemView((s) => s.hydrate);
  const key = ids
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
    .join(",");

  useEffect(() => {
    const clean = key.length
      ? key.split(",").map(Number)
      : [];
    if (!clean.length) return;
    const missing = clean.filter(
      (id) => !useTriagemView.getState().byFixture[id] && !requested.has(id),
    );
    if (!missing.length) return;
    missing.forEach((id) => requested.add(id));

    void sync({ data: { ids: missing } })
      .then((res) => {
        if (res?.length) hydrate(res);
      })
      .catch(() => {})
      .finally(() => {
        for (const id of missing) requested.delete(id);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, sync, hydrate]);
}

/** Nota mínima exigida pelo mercado (75 padrão; 95 em placar/empates). */
export function triagemMinFor(marketType: string): number {
  const key = marketType as keyof typeof MIN_SCORE_BY_MARKET;
  return MIN_SCORE_BY_MARKET[key] ?? MIN_SCORE;
}

/** Um mercado publicado (passed) respeitando o mínimo por mercado. */
function meetsMin(m: TriagemMarketBadge): boolean {
  return m.passed && m.score >= triagemMinFor(m.market_type);
}

/** Selos da triagem de um jogo (mercados publicados, ainda não conferidos). */
export function triagemSelosFor(fixtureId: number): TriagemMarketBadge[] {
  const view = useTriagemView.getState().byFixture[fixtureId];
  if (!view) return [];
  return view.markets.filter((m) => meetsMin(m) && m.status === "pending");
}

/** Todos os mercados publicados da triagem de um jogo (inclui verdes/vermelhos já conferidos). */
export function triagemPassedFor(fixtureId: number): TriagemMarketBadge[] {
  const view = useTriagemView.getState().byFixture[fixtureId];
  if (!view) return [];
  return view.markets.filter((m) => meetsMin(m));
}

/** Nota geral de um jogo na Triagem (maior score dentre os publicados). */
export function triagemScoreFor(fixtureId: number): number | null {
  const viewed = useTriagemView.getState().byFixture[fixtureId];
  if (!viewed) return null;
  const passed = viewed.markets.filter((m) => meetsMin(m));
  if (!passed.length) return null;
  return Math.max(...passed.map((m) => m.score));
}

/**
 * Pré-carrega no store os selos da Triagem de TODOS os jogos das próximas 24h.
 * Uma única leitura do Supabase (zero API-Football); usada ao entrar logado
 * para todas as abas abrirem com os selos já disponíveis.
 */
export async function preloadSelos24h(): Promise<number> {
  try {
    const views = await getProximas24hSelos({});
    if (!Array.isArray(views) || !views.length) return 0;
    useTriagemView.getState().hydrate(views);
    return views.length;
  } catch {
    // best-effort: se falhar, os selos chegam por rota como hoje.
    return 0;
  }
}