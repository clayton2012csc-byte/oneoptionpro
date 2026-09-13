# Corrigir o login com Google

O erro "403. Isto é um erro. Você não tem acesso a esta página" vem do próprio Google, antes mesmo de voltar para o site. Isso acontece quando a conta Google usada para entrar não está autorizada no aplicativo criado no Google Cloud, ou quando o endereço de retorno cadastrado lá não bate com o do Supabase. Como o provedor Google ainda não foi ativado no painel do Supabase, o caminho precisa ser montado do começo.

Boa parte disso é configuração em painéis externos (Google e Supabase) — não dá para fazer pelo código. Vou deixar o passo a passo pronto e ajustar o app para o que depende dele.

## Parte 1 — Criar o acesso no Google (você faz)

1. Entre no Google Cloud Console e crie (ou escolha) um projeto.
2. Em "Tela de permissão OAuth": tipo **Externo**, preencha nome do app, e-mail de suporte e e-mail do desenvolvedor.
3. Enquanto o app estiver em modo de teste, adicione seu e-mail em **Usuários de teste** — essa é a causa mais comum do erro 403. Se preferir, use "Publicar aplicativo" para liberar para qualquer conta.
4. Em "Credenciais", crie um **ID do cliente OAuth** do tipo **Aplicativo da Web**.
5. Guarde o **Client ID** e o **Client Secret**.

## Parte 2 — Ligar o Google no Supabase (você faz)

1. No painel do Supabase: Authentication → Providers → Google → ativar.
2. Cole o Client ID e o Client Secret.
3. Copie a **Callback URL** que o Supabase mostra e cole no Google Cloud, em "URIs de redirecionamento autorizados" do cliente OAuth.
4. Em Authentication → URL Configuration, defina a Site URL como `https://oneoptionpro.lovable.app`.
5. Em Redirect URLs, adicione:
   - `https://oneoptionpro.lovable.app/auth`
   - o endereço de pré-visualização do editor com `/auth` no final
   - `http://localhost:8080/auth`

## Parte 3 — Ajustes no app (eu faço)

- Mensagens de erro claras na tela de login: separar "provedor não ativado", "endereço de retorno não autorizado" e "conta sem permissão no Google", em vez do texto genérico atual.
- Fazer o retorno do Google funcionar igual na pré-visualização e no site publicado, usando sempre o endereço da janela atual.
- Manter o botão do Google visível, mas com aviso amigável quando o provedor ainda não estiver ativo.
- Atualizar o README com esse passo a passo, incluindo o item de usuários de teste.

## Depois de tudo pronto

Testo o fluxo de entrada no app e confirmo se a sessão é criada e os dados passam a ser salvos na sua conta.

## Detalhes técnicos

- `src/routes/auth.tsx`: tratamento de `error`/`error_description` retornados no query string e no hash, com mapeamento para mensagens específicas; `redirectTo` continua `${window.location.origin}/auth`.
- Nenhuma alteração na troca PKCE existente (`exchangeCodeForSession`) nem no cliente Supabase.
