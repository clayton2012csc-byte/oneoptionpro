/**
 * Regras e seleção de mercados do robô de bilhetes automáticos.
 *
 * Fonte única de verdade das taxas históricas reais medidas na conferência
 * automática (`auto_tickets` consolidado por `computeMarketRanking`).
 *
 * Todos os 11 mercados continuam ativos (são o foco do site). Para "melhorar"
 * os mercados de baixa taxa, o robô exige mais confiança do modelo antes de
 * publicar o palpite — quanto menor o acerto histórico, maior o piso de
 * confiança (`confidence = prob / teto`) necessário.
 */

/** Barra usada para definir quando um mercado precisa de piso extra de confiança. */
export const MIN_HISTORIC_ACCURACY = 0.45;

/**
 * Acerto histórico real por mercado (últimos bilhetes conferidos).
 * Valores observados no `market_ranking_snapshot` do banco.
 */
export const MARKET_HISTORIC_ACCURACY: Record<string, number> = {
  "Escanteios": 1.0,
  "Cartões": 1.0,
  "Gols Dinâmico": 0.56,
  "Aposta Montada": 0.46,
  "Resultado 1X2": 0.4,
  "Ambas Marcam": 0.36,
  "Intervalo / Final": 0.16,
  "Margem de Vitória": 0.12,
  "Placar Múltiplo Exato": 0.12,
  "Placar Exato Seco": 0.0,
  "Evolução do Jogo": 0.0,
};

/** Leituras diretas da previsão usadas para emergência de fallback da seletividade. */
export function marketAccuracy(market: string): number | null {
  return MARKET_HISTORIC_ACCURACY[market] ?? null;
}

/** Mercados com taxa histórica abaixo da barra de foco (precisam de mais seleção). */
export function isBelowFocusThreshold(market: string): boolean {
  const acc = marketAccuracy(market);
  return acc != null && acc < MIN_HISTORIC_ACCURACY;
}

/** Confiança mínima (prob / teto) exigida de um mercado antes de publicar. */
export const MIN_CRITICAL_CONFIDENCE = 0.65;
export const LOW_ACCURACY_CONFIDENCE = 0.8;

export function requiredConfidence(market: string): number {
  return isBelowFocusThreshold(market) ? LOW_ACCURACY_CONFIDENCE : MIN_CRITICAL_CONFIDENCE;
}