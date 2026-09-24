# Migração do banco atual para o Lovable Cloud

## Objetivo
Trocar o banco atual pelo Lovable Cloud sem perder histórico, login ou automações.

## Etapas
1. **Ativar o Lovable Cloud** no projeto (não dá para desfazer depois).
2. **Recriar a estrutura**: todas as tabelas (fechamentos, ai_rounds, ai_predictions, ai_tickets, ai_weights, ai_selftest, api_cache, auto_tickets, assistant_messages, betano_tickets, triagem_records e demais), índices, gatilhos, permissões e regras de segurança, a partir dos arquivos SQL já existentes.
3. **Copiar os dados**: ler tudo do banco atual (em lotes, respeitando o limite de 1000 linhas por leitura) e gravar no Cloud. O cache da API (api_cache) é copiado só no que ainda estiver válido.
4. **Trocar a conexão do site**: o site passa a usar o cliente do Cloud; as variáveis antigas deixam de ser usadas.
5. **Login**: e-mail e senha continuam. Contas antigas NÃO migram com senha — cada usuário cria a conta de novo (ou entra pelo Google, que o Cloud já oferece pronto). Os fechamentos pessoais são religados ao novo usuário pelo e-mail.
6. **Agendamentos**: recriar os 6 agendamentos (+ preparo de jogos) dentro do Cloud, apontando para o site publicado.
7. **Segredos**: manter CRON_SECRET, chave do Gemini e da API-Football.
8. **Conferir**: comparar contagem de linhas por tabela entre o banco antigo e o novo, abrir as telas principais e rodar uma varredura de teste.

## Limites
- O banco antigo fica intacto como cópia de segurança até você mandar desligar.
- Durante a cópia (alguns minutos), selos novos gravados no banco antigo podem ficar de fora; rodo uma segunda passada no final.
- Depois da troca é preciso publicar o site para as automações usarem o banco novo.
