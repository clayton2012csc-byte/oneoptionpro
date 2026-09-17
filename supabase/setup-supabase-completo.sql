-- OneOption — instalação completa e idempotente do Supabase nativo.
-- Execute este arquivo inteiro no SQL Editor do seu projeto Supabase.
-- Pode ser executado novamente com segurança para reconciliar instalações existentes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Fechamentos salvos por usuário
CREATE TABLE IF NOT EXISTS public.fechamentos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id text NOT NULL,
  name text NOT NULL,
  target_date date NOT NULL,
  games jsonb NOT NULL DEFAULT '[]'::jsonb,
  tickets jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE public.fechamentos ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_fechamentos_device ON public.fechamentos(device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fechamentos_user ON public.fechamentos(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fechamentos TO authenticated;
GRANT ALL ON public.fechamentos TO service_role;
REVOKE ALL ON public.fechamentos FROM anon;
ALTER TABLE public.fechamentos ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE p record; BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'fechamentos' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.fechamentos', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "own_select" ON public.fechamentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_insert" ON public.fechamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_update" ON public.fechamentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_delete" ON public.fechamentos FOR DELETE TO authenticated USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS update_fechamentos_updated_at ON public.fechamentos;
CREATE TRIGGER update_fechamentos_updated_at BEFORE UPDATE ON public.fechamentos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Rodadas da IA
CREATE TABLE IF NOT EXISTS public.ai_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL CHECK (slot IN ('morning','afternoon','night')),
  ran_at timestamptz NOT NULL DEFAULT now(),
  weights_version integer NOT NULL DEFAULT 1,
  fixtures_analyzed integer NOT NULL DEFAULT 0,
  api_calls integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_rounds TO anon, authenticated;
GRANT ALL ON public.ai_rounds TO service_role;
ALTER TABLE public.ai_rounds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ai_rounds" ON public.ai_rounds;
DROP POLICY IF EXISTS "Public read rounds" ON public.ai_rounds;
DROP POLICY IF EXISTS "Public Read Rounds" ON public.ai_rounds;
CREATE POLICY "Public read ai_rounds" ON public.ai_rounds FOR SELECT TO anon, authenticated USING (true);
DROP TRIGGER IF EXISTS trg_ai_rounds_updated ON public.ai_rounds;
CREATE TRIGGER trg_ai_rounds_updated BEFORE UPDATE ON public.ai_rounds
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Previsões e snapshots de scanner
CREATE TABLE IF NOT EXISTS public.ai_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES public.ai_rounds(id) ON DELETE CASCADE,
  fixture_id bigint NOT NULL,
  market text NOT NULL,
  probability numeric(6,4) NOT NULL,
  score numeric(5,2) NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  vetoed boolean NOT NULL DEFAULT false,
  veto_reason text,
  result jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_predictions ADD COLUMN IF NOT EXISTS result jsonb;
-- linha dinâmica escolhida no mercado "Gols Dinâmico" (ex.: "Over 1.5", "Over 0.5 HT")
ALTER TABLE public.ai_predictions ADD COLUMN IF NOT EXISTS market_sub_type text;
CREATE INDEX IF NOT EXISTS ai_predictions_round_idx ON public.ai_predictions(round_id);
CREATE INDEX IF NOT EXISTS ai_predictions_fixture_idx ON public.ai_predictions(fixture_id);
GRANT SELECT, INSERT, UPDATE ON public.ai_predictions TO anon, authenticated;
GRANT ALL ON public.ai_predictions TO service_role;
ALTER TABLE public.ai_predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ai_predictions" ON public.ai_predictions;
DROP POLICY IF EXISTS "Allow insert ai_predictions" ON public.ai_predictions;
DROP POLICY IF EXISTS "Allow update ai_predictions" ON public.ai_predictions;
DROP POLICY IF EXISTS "Public manage predictions" ON public.ai_predictions;
DROP POLICY IF EXISTS "Public Read Predictions" ON public.ai_predictions;
CREATE POLICY "Public read ai_predictions" ON public.ai_predictions FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Allow insert ai_predictions" ON public.ai_predictions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update ai_predictions" ON public.ai_predictions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Bilhetes das rodadas da IA
CREATE TABLE IF NOT EXISTS public.ai_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES public.ai_rounds(id) ON DELETE CASCADE,
  ticket_type text NOT NULL CHECK (ticket_type IN ('B1','B2','B3','B4','B5')),
  fixtures jsonb NOT NULL DEFAULT '[]'::jsonb,
  composite_score numeric(5,2) NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','green','red','void')),
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_tickets_round_idx ON public.ai_tickets(round_id);
CREATE INDEX IF NOT EXISTS ai_tickets_status_idx ON public.ai_tickets(status);
GRANT SELECT ON public.ai_tickets TO anon, authenticated;
GRANT ALL ON public.ai_tickets TO service_role;
ALTER TABLE public.ai_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ai_tickets" ON public.ai_tickets;
DROP POLICY IF EXISTS "Public read tickets" ON public.ai_tickets;
DROP POLICY IF EXISTS "Public Read Tickets" ON public.ai_tickets;
CREATE POLICY "Public read ai_tickets" ON public.ai_tickets FOR SELECT TO anon, authenticated USING (true);
DROP TRIGGER IF EXISTS trg_ai_tickets_updated ON public.ai_tickets;
CREATE TRIGGER trg_ai_tickets_updated BEFORE UPDATE ON public.ai_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Pesos e autoavaliação da IA
CREATE TABLE IF NOT EXISTS public.ai_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  weights jsonb NOT NULL,
  reason text,
  accuracy_30d numeric(5,2),
  roi_30d numeric(6,2),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_weights TO anon, authenticated;
GRANT ALL ON public.ai_weights TO service_role;
ALTER TABLE public.ai_weights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ai_weights" ON public.ai_weights;
DROP POLICY IF EXISTS "Public read weights" ON public.ai_weights;
CREATE POLICY "Public read ai_weights" ON public.ai_weights FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.ai_weights (version, weights, reason)
VALUES (
  1,
  '{"base_strength":0.35,"form":0.20,"h2h":0.10,"injuries":0.15,"predictions_api":0.10,"home_advantage":0.10}'::jsonb,
  'Pesos iniciais baseados em literatura de apostas esportivas'
)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.ai_selftest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  backtest_accuracy numeric(5,2),
  calibration_brier numeric(6,4),
  veto_rate numeric(5,2),
  weight_drift numeric(5,2),
  passed boolean NOT NULL DEFAULT false,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_selftest TO anon, authenticated;
GRANT ALL ON public.ai_selftest TO service_role;
ALTER TABLE public.ai_selftest ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read ai_selftest" ON public.ai_selftest;
DROP POLICY IF EXISTS "Public read selftest" ON public.ai_selftest;
CREATE POLICY "Public read ai_selftest" ON public.ai_selftest FOR SELECT TO anon, authenticated USING (true);

-- Cache e travas internas; somente o servidor pode acessar
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

-- Bilhetes automáticos e ranking de mercados
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
CREATE POLICY "Public read auto tickets" ON public.auto_tickets FOR SELECT TO anon, authenticated USING (true);
DROP TRIGGER IF EXISTS trg_auto_tickets_updated ON public.auto_tickets;
CREATE TRIGGER trg_auto_tickets_updated BEFORE UPDATE ON public.auto_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX IF NOT EXISTS idx_auto_tickets_kickoff ON public.auto_tickets(kickoff DESC);
CREATE INDEX IF NOT EXISTS idx_auto_tickets_status ON public.auto_tickets(status);

-- Conversas do assistente por usuário
CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "own_select_assistant_messages" ON public.assistant_messages;
DROP POLICY IF EXISTS "own_insert_assistant_messages" ON public.assistant_messages;
DROP POLICY IF EXISTS "own_delete_assistant_messages" ON public.assistant_messages;
CREATE POLICY "own_select_assistant_messages" ON public.assistant_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_insert_assistant_messages" ON public.assistant_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_delete_assistant_messages" ON public.assistant_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_assistant_messages_user_created ON public.assistant_messages(user_id, created_at);

-- Bilhetes especiais Betano por usuário
CREATE TABLE IF NOT EXISTS public.betano_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.betano_tickets TO authenticated;
GRANT ALL ON public.betano_tickets TO service_role;
ALTER TABLE public.betano_tickets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own Betano tickets" ON public.betano_tickets;
CREATE POLICY "Users can manage their own Betano tickets" ON public.betano_tickets
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
