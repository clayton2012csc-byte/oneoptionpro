-- OneOptionIA — Motor de Triagem (filtro de elite por mercado).
-- Idempotente: pode rodar quantas vezes quiser no SQL Editor do Supabase.

CREATE TABLE IF NOT EXISTS public.triagem_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fixture_id int8 NOT NULL,
  match_name text NOT NULL,
  league text,
  kickoff timestamptz,
  market_type text NOT NULL CHECK (market_type IN (
    'under_1_5','over_1_5','ambas_sim','ambas_nao','placar_exato',
    'casa_vence','empate_com_gol','empate_sem_gols','visitante_ganha'
  )),
  predicted_value text NOT NULL,
  score_confidence int4 NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','green','red','void')),
  result_score text,
  created_at timestamptz NOT NULL DEFAULT now(),
  graded_at timestamptz
);

ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS league text;
ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS kickoff timestamptz;
ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS result_score text;
ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS graded_at timestamptz;

-- Um jogo pode entrar em vários mercados, mas só uma vez em cada.
CREATE UNIQUE INDEX IF NOT EXISTS triagem_fixture_market_uidx
  ON public.triagem_records (fixture_id, market_type);
CREATE INDEX IF NOT EXISTS triagem_market_idx ON public.triagem_records (market_type, status);
CREATE INDEX IF NOT EXISTS triagem_kickoff_idx ON public.triagem_records (kickoff DESC);
CREATE INDEX IF NOT EXISTS triagem_status_idx ON public.triagem_records (status);

GRANT SELECT ON public.triagem_records TO anon;
GRANT SELECT ON public.triagem_records TO authenticated;
GRANT ALL ON public.triagem_records TO service_role;

ALTER TABLE public.triagem_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'triagem_records' AND policyname = 'triagem leitura publica'
  ) THEN
    CREATE POLICY "triagem leitura publica" ON public.triagem_records FOR SELECT USING (true);
  END IF;
END $$;
