# OneOption — instalação independente

Este projeto usa **Supabase nativo** com `@supabase/supabase-js`. Não depende do Lovable Cloud para banco ou autenticação.

## 1. Instalar o banco

Crie um projeto no Supabase, abra **SQL Editor**, cole todo o conteúdo de [`supabase/setup-supabase-completo.sql`](supabase/setup-supabase-completo.sql) e execute.

O instalador pode ser executado novamente e prepara as dez tabelas usadas pelo aplicativo, seus campos, índices, permissões, políticas de segurança, gatilhos e os pesos iniciais da IA. O app atual não usa Storage nem funções RPC, então não é necessário criar bucket ou RPC.

## 2. Configurar variáveis

Copie `.env.example` para `.env` e preencha:

- `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`: conexão pública do navegador.
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`: conexão no servidor.
- `CRON_SECRET`: segredo longo e exclusivo para proteger tarefas automáticas.
- `GEMINI_API_KEY`: análises com IA (Google Gemini).
- `API_FOOTBALL_KEY`: jogos, estatísticas e resultados.
- `VITE_SITE_URL`: URL pública final.

Nunca exponha `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `GEMINI_API_KEY` ou `API_FOOTBALL_KEY` no navegador.

## 3. Ativar login Google

### 3.1 Google Cloud Console

1. Crie ou escolha um projeto.
2. Em **Tela de permissão OAuth**, escolha o tipo **Externo** e preencha nome do app, e-mail de suporte e e-mail do desenvolvedor.
3. Enquanto o app estiver em modo de teste, adicione seu e-mail em **Usuários de teste**. Sem isso o Google responde `403 — Você não tem acesso a esta página`. Alternativa: usar **Publicar aplicativo**.
4. Em **Credenciais**, crie um **ID do cliente OAuth** do tipo **Aplicativo da Web** e guarde Client ID e Client Secret.

### 3.2 Supabase

1. Abra **Authentication → Providers → Google** e habilite o provedor.
2. Informe o Client ID e Client Secret criados no Google Cloud.
3. Copie a **Callback URL** exibida pelo Supabase e cadastre-a em **URIs de redirecionamento autorizados** no cliente OAuth do Google Cloud.
4. Em **Authentication → URL Configuration**, defina a Site URL pública do site.
5. Adicione às Redirect URLs: `https://SEU-DOMINIO/auth`, o endereço de pré-visualização do editor com `/auth` e, durante desenvolvimento, `http://localhost:8080/auth`.

Login com e-mail e senha também é suportado.

## 4. Agendamentos automáticos (opcional)

Depois de publicar o aplicativo, copie [`supabase/setup-agendamentos.example.sql`](supabase/setup-agendamentos.example.sql), substitua o domínio e a chave pelos valores reais e execute no SQL Editor. O arquivo agenda rodadas da IA, conferência e geração de bilhetes automáticos.

Não execute o modelo sem substituir `SEU-DOMINIO` e `SUA_CHAVE_CRON`.

## 5. Rodar localmente

```sh
bun install
bun run dev
```

## 6. Sincronização com GitHub

O projeto pode ser conectado a um repositório GitHub pelo editor do Lovable:

1. No editor, clique no botão **+** no canto inferior esquerdo.
2. Vá em **GitHub → Connect project**.
3. Autorize o app do Lovable e escolha a conta/organização.
4. Clique em **Create Repository**.

Depois de conectado, qualquer alteração no código sincroniza automaticamente com o GitHub.

## 4.1 Agendamentos prontos

Use `supabase/setup-agendamentos.sql`: já vem com o endereço publicado; basta trocar `SUA_CHAVE_CRON` pelo valor de `CRON_SECRET` e executar no SQL Editor.
