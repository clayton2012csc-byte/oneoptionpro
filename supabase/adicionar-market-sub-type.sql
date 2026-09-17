-- Grava a linha dinâmica escolhida no mercado "Gols Dinâmico".
-- Execute no SQL Editor do seu projeto Supabase (pode rodar mais de uma vez).
ALTER TABLE public.ai_predictions ADD COLUMN IF NOT EXISTS market_sub_type text;
