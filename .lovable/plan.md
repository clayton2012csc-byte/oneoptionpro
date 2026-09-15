# Como o robô monta os bilhetes (e o que falta ligar)

## Como está hoje (verificado no código e no banco)

- O robô olha a lista dos **próximos jogos das 24 horas seguintes** e vai montando bilhete por bilhete.
- Ele **nunca refaz** um jogo já montado: antes de gerar, confere quais já existem e monta só os novos. Conforme aparecem jogos novos na lista, eles entram nas execuções seguintes.
- Cada execução monta **um lote pequeno**, com pausa entre jogos, e só pode rodar **1 vez a cada 15 minutos**. A conferência dos resultados roda no máximo 1 vez a cada 30 minutos. Isso é justamente a proteção contra estourar o limite da fonte de dados.
- Jogo sem histórico suficiente é marcado como "sem amostra" para não travar a fila.
- Situação atual no banco: 11 jogos tratados (4 aguardando, 4 já conferidos, 3 sem amostra). Ou seja: a montagem está correta, só está rodando pouco.

## Por que a lista parece parada em poucos bilhetes

O robô só roda quando alguém o dispara. O agendamento automático (a cada 15 minutos para montar, a cada 10 para conferir) está escrito num arquivo pronto, mas ainda **não foi ativado no seu painel do banco** — por isso a lista só cresce quando eu disparo manualmente.

## O que proponho fazer

1. Ativar o agendamento automático no seu banco, com a chave secreta já existente preenchida (montagem a cada 15 min, conferência a cada 10 min). Você cola o script uma única vez no painel; eu deixo o arquivo pronto, sem placeholder.
2. Deixar o lote de cada execução em um tamanho seguro (em torno de 25 jogos por rodada), mantendo a pausa entre jogos e as travas de 15/30 minutos — em um dia isso cobre folgadamente a lista de 24 horas sem chegar perto do limite diário da fonte de dados.
3. Disparar uma rodada depois de ativado e confirmar: número de bilhetes montados, jogos novos entrando e resultados sendo conferidos.

## Detalhes técnicos

- `src/lib/auto-tickets.server.ts`: `HORIZON_HOURS = 24`, `SCAN_INTERVAL_MS = 15 min`, `GRADE_INTERVAL_MS = 30 min`, `GAP_MS = 150`, deduplicação por `fixture_id` em `auto_tickets`, lock de execução e limpeza de cache expirado.
- `supabase/setup-agendamentos.sql`: jobs pg_cron/pg_net para `/api/public/ai/auto-tickets?limit=25` (*/15) e `?mode=grade&limit=200` (*/10), além das rodadas de IA. Será entregue com a chave `CRON_SECRET` já preenchida.
- Nenhuma busca em lote adicional será introduzida; o custo por jogo continua o mesmo de hoje.
