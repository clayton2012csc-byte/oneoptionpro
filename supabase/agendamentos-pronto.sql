-- OneOption — agendamentos automáticos (pronto para uso).
-- Único passo antes de executar: troque i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM pelo valor da chave CRON_SECRET
-- (copie em Configurações do projeto na Lovable > Segredos > CRON_SECRET).
-- Depois cole tudo no SQL Editor do Supabase e execute.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  PERFORM cron.unschedule(jobname) FROM cron.job
  WHERE jobname IN (
    'oneoption-ai-round-morning',
    'oneoption-ai-round-afternoon',
    'oneoption-ai-round-night',
    'oneoption-ai-selftest-daily',
    'oneoption-auto-tickets',
    'oneoption-auto-tickets-grade'
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule('oneoption-ai-round-morning', '0 10 * * *', $$
  SELECT net.http_post(url := 'https://oneoptionpro.lovable.app/api/public/ai/round?slot=morning', headers := '{"Content-Type":"application/json","x-cron-secret":"i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM"}'::jsonb, body := '{}'::jsonb);
$$);
SELECT cron.schedule('oneoption-ai-round-afternoon', '0 16 * * *', $$
  SELECT net.http_post(url := 'https://oneoptionpro.lovable.app/api/public/ai/round?slot=afternoon', headers := '{"Content-Type":"application/json","x-cron-secret":"i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM"}'::jsonb, body := '{}'::jsonb);
$$);
SELECT cron.schedule('oneoption-ai-round-night', '0 21 * * *', $$
  SELECT net.http_post(url := 'https://oneoptionpro.lovable.app/api/public/ai/round?slot=night', headers := '{"Content-Type":"application/json","x-cron-secret":"i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM"}'::jsonb, body := '{}'::jsonb);
$$);
SELECT cron.schedule('oneoption-ai-selftest-daily', '0 2 * * *', $$
  SELECT net.http_post(url := 'https://oneoptionpro.lovable.app/api/public/ai/selftest', headers := '{"Content-Type":"application/json","x-cron-secret":"i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM"}'::jsonb, body := '{}'::jsonb);
$$);
SELECT cron.schedule('oneoption-auto-tickets', '*/15 * * * *', $$
  SELECT net.http_post(url := 'https://oneoptionpro.lovable.app/api/public/ai/auto-tickets?limit=25', headers := '{"Content-Type":"application/json","x-cron-secret":"i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM"}'::jsonb, body := '{}'::jsonb);
$$);
SELECT cron.schedule('oneoption-auto-tickets-grade', '*/10 * * * *', $$
  SELECT net.http_post(url := 'https://oneoptionpro.lovable.app/api/public/ai/auto-tickets?mode=grade&limit=200', headers := '{"Content-Type":"application/json","x-cron-secret":"i05cdJRZEB1Bgfe32qdN8ib1oRlzBbC0F1UVCk99C98A66DM"}'::jsonb, body := '{}'::jsonb);
$$);
