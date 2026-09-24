GRANT INSERT, UPDATE ON public.ai_predictions TO anon, authenticated;
CREATE POLICY "Allow insert ai_predictions" ON public.ai_predictions FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "Allow update ai_predictions" ON public.ai_predictions FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);