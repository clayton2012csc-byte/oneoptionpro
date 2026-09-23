# Carregamento instantâneo dos jogos

## Objetivo
Fazer os cartões abrirem imediatamente e manter jogos, selos e detalhes já vistos disponíveis no navegador, sem criar novas buscas automáticas na API-Football.

## Implementação
- Criar um cache leve e durável dos jogos no navegador, com validade de 7 dias e limite seguro de registros.
- Alimentar esse cache assim que as listas chegam, não apenas quando cada cartão entra na tela.
- Usar o jogo salvo como conteúdo inicial da página de detalhes, inclusive após recarregar ou voltar ao site.
- Preparar antecipadamente a tela de detalhes quando os cartões se aproximarem da área visível, incluindo toque no celular.
- Ampliar a duração do cache geral para 7 dias e manter os selos já persistidos.
- Não adicionar nenhuma varredura nem chamada automática nova à API-Football.

## Validação
- Confirmar abertura imediata a partir da lista em desktop e celular.
- Confirmar que o jogo abre com o conteúdo salvo após recarregar.
- Confirmar que a página e o projeto compilam sem erros.
