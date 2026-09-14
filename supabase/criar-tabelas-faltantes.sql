-- Cria APENAS as duas tabelas que ainda faltam no banco: api_cache e auto_tickets.
-- Pode rodar quantas vezes quiser (é seguro / idempotente).

-- Função auxiliar usada pelo gatilho de atualização
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 1) Cache das respostas da API de futebol (somente o servidor acessa)
CREATE TABLE IF NOT EXISTS public.api_cache (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
REVOKE ALL ON public.api_cache FROM anon, authenticated;
GRANT ALL ON public.api_cache TO service_role;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public Read Cache" ON public.api_cache;
DROP POLICY IF EXISTS "Service role can do everything on api_cache" ON public.api_cache;
CREATE POLICY "Service role can do everything on api_cache" ON public.api_cache
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 2) Bilhetes automáticos
CREATE TABLE IF NOT EXISTS public.auto_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id bigint NOT NULL UNIQUE,
  kickoff timestamptz NOT NULL,
  league text,
  home text NOT NULL,
  away text NOT NULL,
  home_logo text,
  away_logo text,
  picks jsonb NOT NULL DEFAULT '[]'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  result jsonb,
  result_snapshot jsonb,
  greens integer NOT NULL DEFAULT 0,
  reds integer NOT NULL DEFAULT 0,
  accuracy numeric,
  graded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.auto_tickets ADD COLUMN IF NOT EXISTS result_snapshot jsonb;
GRANT SELECT ON public.auto_tickets TO anon, authenticated;
GRANT ALL ON public.auto_tickets TO service_role;
ALTER TABLE public.auto_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read auto tickets" ON public.auto_tickets;
CREATE POLICY "Public read auto tickets" ON public.auto_tickets
  FOR SELECT TO anon, authenticated USING (true);
DROP TRIGGER IF EXISTS trg_auto_tickets_updated ON public.auto_tickets;
CREATE TRIGGER trg_auto_tickets_updated BEFORE UPDATE ON public.auto_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_auto_tickets_kickoff ON public.auto_tickets(kickoff DESC);
CREATE INDEX IF NOT EXISTS idx_auto_tickets_status ON public.auto_tickets(status);
