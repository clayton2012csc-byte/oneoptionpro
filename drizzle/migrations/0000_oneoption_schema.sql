CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.fechamentos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  device_id text NOT NULL, name text NOT NULL, target_date date NOT NULL,
  games jsonb NOT NULL DEFAULT '[]'::jsonb, tickets jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb, checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid
);
CREATE INDEX idx_fechamentos_device ON public.fechamentos(device_id, created_at DESC);
CREATE INDEX idx_fechamentos_user ON public.fechamentos(user_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fechamentos TO authenticated;
GRANT ALL ON public.fechamentos TO service_role;
ALTER TABLE public.fechamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_select" ON public.fechamentos FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_insert" ON public.fechamentos FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_update" ON public.fechamentos FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_delete" ON public.fechamentos FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE TRIGGER update_fechamentos_updated_at BEFORE UPDATE ON public.fechamentos FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot text NOT NULL CHECK (slot IN ('morning','afternoon','night')),
  ran_at timestamptz NOT NULL DEFAULT now(), weights_version integer NOT NULL DEFAULT 1,
  fixtures_analyzed integer NOT NULL DEFAULT 0, api_calls integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  notes text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_rounds TO anon, authenticated;
GRANT ALL ON public.ai_rounds TO service_role;
ALTER TABLE public.ai_rounds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ai_rounds" ON public.ai_rounds FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER trg_ai_rounds_updated BEFORE UPDATE ON public.ai_rounds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES public.ai_rounds(id) ON DELETE CASCADE,
  fixture_id bigint NOT NULL, market text NOT NULL,
  probability numeric NOT NULL, score numeric NOT NULL,
  features jsonb NOT NULL DEFAULT '{}'::jsonb, vetoed boolean NOT NULL DEFAULT false,
  veto_reason text, result jsonb, market_sub_type text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_predictions_round_idx ON public.ai_predictions(round_id);
CREATE INDEX ai_predictions_fixture_idx ON public.ai_predictions(fixture_id);
CREATE INDEX ai_predictions_market_created_idx ON public.ai_predictions(market, created_at DESC);
GRANT SELECT ON public.ai_predictions TO anon, authenticated;
GRANT ALL ON public.ai_predictions TO service_role;
ALTER TABLE public.ai_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ai_predictions" ON public.ai_predictions FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.ai_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid REFERENCES public.ai_rounds(id) ON DELETE CASCADE,
  ticket_type text NOT NULL CHECK (ticket_type IN ('B1','B2','B3','B4','B5')),
  fixtures jsonb NOT NULL DEFAULT '[]'::jsonb, composite_score numeric NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','green','red','void')),
  settled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_tickets_round_idx ON public.ai_tickets(round_id);
CREATE INDEX ai_tickets_status_idx ON public.ai_tickets(status);
GRANT SELECT ON public.ai_tickets TO anon, authenticated;
GRANT ALL ON public.ai_tickets TO service_role;
ALTER TABLE public.ai_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ai_tickets" ON public.ai_tickets FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER trg_ai_tickets_updated BEFORE UPDATE ON public.ai_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.ai_weights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL UNIQUE,
  weights jsonb NOT NULL, reason text, accuracy_30d numeric, roi_30d numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_weights TO anon, authenticated;
GRANT ALL ON public.ai_weights TO service_role;
ALTER TABLE public.ai_weights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ai_weights" ON public.ai_weights FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.ai_selftest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ran_at timestamptz NOT NULL DEFAULT now(),
  backtest_accuracy numeric, calibration_brier numeric, veto_rate numeric, weight_drift numeric,
  passed boolean NOT NULL DEFAULT false, details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.ai_selftest TO anon, authenticated;
GRANT ALL ON public.ai_selftest TO service_role;
ALTER TABLE public.ai_selftest ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read ai_selftest" ON public.ai_selftest FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.api_cache (
  key text PRIMARY KEY, data jsonb NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz DEFAULT now()
);
GRANT ALL ON public.api_cache TO service_role;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role api_cache" ON public.api_cache FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX idx_api_cache_expires ON public.api_cache(expires_at);

CREATE TABLE public.auto_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  fixture_id bigint NOT NULL UNIQUE, kickoff timestamptz NOT NULL, league text,
  home text NOT NULL, away text NOT NULL, home_logo text, away_logo text,
  picks jsonb NOT NULL DEFAULT '[]'::jsonb, meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending', result jsonb, result_snapshot jsonb,
  greens integer NOT NULL DEFAULT 0, reds integer NOT NULL DEFAULT 0, accuracy numeric,
  graded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.auto_tickets TO anon, authenticated;
GRANT ALL ON public.auto_tickets TO service_role;
ALTER TABLE public.auto_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read auto tickets" ON public.auto_tickets FOR SELECT TO anon, authenticated USING (true);
CREATE TRIGGER trg_auto_tickets_updated BEFORE UPDATE ON public.auto_tickets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_auto_tickets_kickoff ON public.auto_tickets(kickoff DESC);
CREATE INDEX idx_auto_tickets_status ON public.auto_tickets(status);

CREATE TABLE public.assistant_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY, user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.assistant_messages TO authenticated;
GRANT ALL ON public.assistant_messages TO service_role;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own_select_assistant_messages" ON public.assistant_messages FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own_insert_assistant_messages" ON public.assistant_messages FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_delete_assistant_messages" ON public.assistant_messages FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX idx_assistant_messages_user_created ON public.assistant_messages(user_id, created_at);

CREATE TABLE public.betano_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL, data jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','won','lost')),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.betano_tickets TO authenticated;
GRANT ALL ON public.betano_tickets TO service_role;
ALTER TABLE public.betano_tickets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own betano tickets" ON public.betano_tickets FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE public.triagem_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fixture_id int8 NOT NULL, match_name text NOT NULL,
  league text, kickoff timestamptz,
  market_type text NOT NULL CHECK (market_type IN ('under_1_5','over_1_5','ambas_sim','ambas_nao','placar_exato','casa_vence','empate_com_gol','empate_sem_gols','visitante_ganha')),
  predicted_value text NOT NULL, score_confidence int4 NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','green','red','void')),
  passed boolean NOT NULL DEFAULT true, probability double precision NOT NULL DEFAULT 0,
  ceiling double precision NOT NULL DEFAULT 1, reason jsonb NOT NULL DEFAULT '[]'::jsonb,
  result_score text, created_at timestamptz NOT NULL DEFAULT now(), graded_at timestamptz
);
CREATE UNIQUE INDEX triagem_fixture_market_uidx ON public.triagem_records (fixture_id, market_type);
CREATE INDEX triagem_market_idx ON public.triagem_records (market_type, status);
CREATE INDEX triagem_kickoff_idx ON public.triagem_records (kickoff DESC);
CREATE INDEX triagem_status_idx ON public.triagem_records (status);
CREATE INDEX triagem_passed_idx ON public.triagem_records (passed, status);
CREATE INDEX triagem_created_idx ON public.triagem_records (created_at DESC);
GRANT SELECT ON public.triagem_records TO anon, authenticated;
GRANT ALL ON public.triagem_records TO service_role;
ALTER TABLE public.triagem_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "triagem leitura publica" ON public.triagem_records FOR SELECT TO anon, authenticated USING (true);