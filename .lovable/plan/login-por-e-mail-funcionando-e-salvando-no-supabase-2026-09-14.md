# Login por e-mail funcionando e salvando no Supabase

## Objetivo
Garantir que o usuário consiga criar conta, entrar e ter os dados salvos no Supabase usando apenas e-mail e senha — sem depender do Google.

## O que falta (do seu lado, no painel do Supabase)
O app já tem login por e-mail pronto. O que bloqueia é a confirmação de e-mail obrigatória:

1. Abra o painel do Supabase: https://supabase.com/dashboard
2. Entre no seu projeto
3. Vá em **Authentication → Sign In / Providers** (ou Authentication → Providers)
4. Clique em **Email**
5. Desative a chave **Confirm email** e salve

Com isso, criar conta já entra direto, sem esperar e-mail.

## O que eu faço no app
1. Ajustar `src/routes/auth.tsx`: remover/destacar o botão Google (fica oculto até você configurar o Google no futuro), mantendo e-mail e senha como entrada principal.
2. Melhorar as mensagens da tela de login (criação de conta, senha curta, e-mail já cadastrado).
3. Testar o fluxo completo na pré-visualização: criar conta → entrar → salvar um fechamento → confirmar que gravou no Supabase.
4. Atualizar o README com o passo a passo do e-mail.

## Verificação
- Build e typecheck passando.
- Teste no navegador: cadastro e login funcionando, dados gravados na tabela `fechamentos` do Supabase.

## Observação
As tabelas precisam existir: se ainda não rodou, execute `supabase/setup-supabase-completo.sql` no SQL Editor do Supabase (Database → SQL Editor → colar → Run).
