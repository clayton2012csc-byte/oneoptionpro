-- OneOptionIA — Certificação da Triagem (auditoria + relatório diário de evolução).
-- Idempotente: pode rodar quantas vezes quiser no SQL Editor do Supabase.
-- Alinha a tabela triagem_records para gravar TODOS os 9 mercados avaliados por jogo,
-- não apenas os publicados (nota >= 75). Os que passam viram 'pending'; os reprovados,
-- 'void' (fora do painel, visíveis na Certificação).

ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS passed boolean NOT NULL DEFAULT true;
ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS probability double precision NOT NULL DEFAULT 0;
ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS ceiling double precision NOT NULL DEFAULT 1;
ALTER TABLE public.triagem_records ADD COLUMN IF NOT EXISTS reason jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Linhas antigas (publicadas antes da Certificação) continuam válidas.
UPDATE public.triagem_records SET passed = true WHERE status <> 'void';

-- Índices para o painel de publicados, a certificação e a evolução diária.
CREATE INDEX IF NOT EXISTS triagem_passed_idx ON public.triagem_records (passed, status);
CREATE INDEX IF NOT EXISTS triagem_created_idx ON public.triagem_records (created_at DESC);

-- RLS continua idêntico ao triagem.sql (leitura pública, escrita via service_role).