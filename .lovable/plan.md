# Por que os selos pararam de aparecer sozinhos

## O que encontrei (verificado no banco, agora)

- Existem **841 jogos futuros já com bilhete montado** pelo robô, mas apenas **39 deles têm selo salvo**.
- Dos **44 jogos das próximas 3 horas, nenhum** tem selo salvo — por isso os cartões aparecem "limpos".
- Nas rodadas de hoje às 21h e 22h o robô montou 473 + 368 bilhetes, e no mesmo período só **39 selos** foram gravados.

## A causa

O selo só é gravado **no exato momento em que o bilhete daquele jogo é criado pela primeira vez**, e todos os selos da rodada são gravados de uma vez só, num único bloco gigante. Quando esse bloco falha (rodadas com centenas de jogos), a falha é engolida em silêncio e **o jogo nunca mais recebe selo**: nas rodadas seguintes ele já consta como "jogo conhecido" e é pulado.

Ou seja: quanto maior a rodada, mais selos se perdem. Foi o que aconteceu depois que o robô passou a montar centenas de jogos por execução.

## O que proponho fazer

1. **Gravar os selos em blocos pequenos**, com repetição automática em caso de falha e registro do erro (nunca mais perder em silêncio).
2. **Recuperação automática**: em toda rodada, o robô verifica quais jogos futuros já têm bilhete mas estão sem selo e regrava o selo a partir do palpite já salvo — **sem nenhuma consulta nova à API-Football**.
3. **Rodar uma vez agora** para preencher os ~800 jogos futuros que estão sem selo, incluindo os das próximas 3 horas.
4. Conferir na página inicial que os cartões voltam com os selos.

Observação: para tudo isso se renovar sozinho, ainda falta colar o arquivo `supabase/agendamentos-pronto.sql` no SQL Editor do Supabase — hoje o robô só roda quando eu disparo.

## Detalhes técnicos

- `src/lib/auto-tickets.server.ts` (linhas ~249-308): o array `scans` é preenchido apenas para jogos em `pending` (não existentes em `auto_tickets`) e inserido em `ai_predictions` num único `insert`; o `insErr` só tem fallback para a coluna `market_sub_type` e o erro do fallback é descartado. Passa a: chunk de 50, `delete`+`insert` por chunk, log de erro, e contagem retornada em `notes`.
- Nova função `backfillScanSnapshots(limit)` no mesmo módulo: seleciona `auto_tickets` com `kickoff > now()`, `status = 'pending'` e `picks` não vazio, cruza com `ai_predictions` (`market = 'scan_snapshot'`) e reconstrói o `features` do selo (fixtureId, probabilidades, picks, kickoff, pillarContext) a partir de `picks`/`meta` já persistidos. Chamada ao final de `runAutoTicketsBatch` e exposta no endpoint `/api/public/ai/auto-tickets?mode=backfill`.
- Leitura permanece em `src/lib/scan-cache.functions.ts` (`WINDOW_MS = 72h`, limite 3000) — sem alteração.
