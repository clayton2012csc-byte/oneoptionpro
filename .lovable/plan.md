# Fechamento Betano 3/4 — objetivo mestre do OneOptionIA

Fixar no sistema a sua estratégia e entregar uma tela que monta o bilhete pronto para copiar na Betano.
Nada do que já existe é apagado: é uma camada nova em cima dos palpites que o robô já salva.

## Objetivo mestre (fica gravado)

O OneOptionIA é focado em odds altas. Todo dia ele escolhe os 4 melhores jogos e entrega
3 opções de cobertura por jogo, para você apostar em Sistema 3/4 na Betano.
A partir daqui, sempre que você me chamar, eu já parto desse objetivo.

## As 3 opções por jogo (perfil do jogo decide)

- Perfil Favorito + Ambas Marcam
  1. Placar múltiplo 2x1 / 3x1 / 4x1
  2. Especiais Betano 3x2 / 4x2 / 5x1 (goleada)
  3. Proteção: Empate + Ambas Marcam
- Perfil Jogo Truncado (tendência de empate)
  1. Empate + Mais de 9.5 escanteios
  2. Empate + Menos de 9.5 escanteios (trava: se empatar, uma das duas bate)
  3. Proteção: Placar magro 1x0 / 0x1
- Perfil Favorito Under (defesa forte)
  1. Placar múltiplo 1x0 / 2x0 / 3x0
  2. Vitória do favorito + Menos de 3.5 gols
  3. Proteção: Empate 0x0 / 1x1

Regra de entrada do jogo: mandante favorito acima de 55% ou empate acima do normal,
e a opção de proteção precisa ter odd estimada de pelo menos 5.00.

## A tela nova /fechamentos

- Os 4 jogos do dia escolhidos, com escudos, liga e horário.
- As 3 opções de cada jogo com a odd estimada e o motivo em uma linha.
- Calculadora do Sistema 3/4: R$ 0,50 por combinação, custo total e retorno estimado
  se acertar 3 de 4 e se acertar 4 de 4.
- Botão "Copiar estrutura do fechamento" com o texto pronto para levar para a Betano.
- Botão "Salvar fechamento" usando a tabela de fechamentos que já existe.
- Entrada no menu lateral, ao lado de Triagem.

## Detalhes técnicos

- `src/lib/fechamento-betano.ts`: motor que classifica o perfil do jogo e monta as 3 opções
  (odds estimadas a partir da probabilidade, sem chamada extra à API-Football).
- `src/lib/fechamento-betano.server.ts`: lê `auto_tickets` do dia (mesmo padrão das Múltiplas),
  pontua, escolhe os 4 melhores e guarda o resultado em `api_cache` (1 montagem por dia).
- `src/lib/fechamento-betano.functions.ts`: `getFechamentoBetano()` e `rebuildFechamentoBetano()`.
- `src/routes/fechamentos.tsx` + `src/components/FechamentoBetanoPanel.tsx`: a tela, em vidro,
  no mesmo padrão dos cards de jogo.
- `src/lib/assistant-prompt.ts`: objetivo mestre acrescentado às instruções da IA.
- `src/lib/sections-config.ts`: novo item "Fechamento Betano".

Zero consumo novo de API: tudo sai do que o robô já gravou no banco.
