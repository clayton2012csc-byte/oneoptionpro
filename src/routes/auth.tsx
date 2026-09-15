import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Mail, Lock, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { isSupabaseConfigured } from "@/lib/public-config";
import { BackHeader } from "@/components/BackHeader";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar · OneOptiOn-BetA" },
      { name: "description", content: "Entre na sua conta para salvar e sincronizar seus fechamentos entre dispositivos." },
    ],
  }),
  component: AuthPage,
});

type Mode = "signin" | "signup";

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    try {
      runAuthBootstrap();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível iniciar a tela de login.");
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const NOT_CONFIGURED_MSG =
  "O Supabase ainda não está configurado neste ambiente. Crie o arquivo .env com VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY para liberar o login.";

  function runAuthBootstrap() {
    if (!isSupabaseConfigured()) {
      setError(NOT_CONFIGURED_MSG);
      return;
    }
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const oauthError =
      url.searchParams.get("error_description") ||
      url.searchParams.get("error") ||
      hash.get("error_description") ||
      hash.get("error");
    if (oauthError) {
      setError(decodeURIComponent(oauthError));
      return;
    }

    const code = url.searchParams.get("code");
    if (code) {
      setBusy(true);
      supabase.auth
        .exchangeCodeForSession(code)
        .then(async ({ error }) => {
          window.history.replaceState({}, "", "/auth");
          if (error) {
            // pode já ter sido trocado; confere se a sessão existe mesmo assim
            const { data } = await supabase.auth.getSession();
            if (!data.session) {
              setError(error.message);
              setBusy(false);
              return;
            }
          }
          navigate({ to: "/" });
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : "Falha ao concluir o login com Google");
          setBusy(false);
        });
      return;
    }

    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (data.user) navigate({ to: "/" });
      })
      .catch(() => {});
  }


  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    if (!isSupabaseConfigured()) {
      setError(NOT_CONFIGURED_MSG);
      return;
    }
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Conta criada. Confirme o e-mail que enviamos e depois entre por aqui.");
          setMode("signin");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      navigate({ to: "/" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Falha na autenticação";
      setError(
        /invalid login credentials/i.test(msg)
          ? "E-mail ou senha incorretos."
          : /email not confirmed/i.test(msg)
            ? "Confirme o e-mail antes de entrar. (Dica: no painel do Supabase, em Authentication → Providers → Email, você pode desativar a confirmação.)"
            : /already registered|already been registered/i.test(msg)
              ? "Este e-mail já tem conta. Toque em \"Entrar\" abaixo para acessar."
              : /at least 6/i.test(msg)
                ? "A senha precisa ter pelo menos 6 caracteres."
                : msg,
      );
    } finally {
      setBusy(false);
    }
  };



  return (
    <div className="min-h-screen bg-background px-4">
      <BackHeader title="Entrar" />
      <div className="flex items-center justify-center pt-6">
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl p-6 shadow-xl">
        <div className="text-center mb-5">
          <div className="text-lg font-bold">OneOptiOn-BetA</div>
          <div className="text-xs text-muted-foreground mt-1">
            {mode === "signin" ? "Entre para salvar e sincronizar seus fechamentos" : "Crie sua conta em poucos segundos"}
          </div>
        </div>

        {/* Login com Google fica oculto até o provedor ser ativado no painel do Supabase */}


        <form onSubmit={handleEmail} className="space-y-2.5">
          <div className="relative">
            <Mail className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="E-mail"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm"
            />
          </div>
          <div className="relative">
            <Lock className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha (mín. 6)"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-background border border-border text-sm"
            />
          </div>
          {info && <div className="text-xs text-primary">{info}</div>}
          {error && <div className="text-xs text-destructive">{error}</div>}
          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-lg py-2 text-sm font-bold disabled:opacity-50"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
            {mode === "signin" ? "Entrar" : "Criar conta"}
          </button>
        </form>

        <div className="text-xs text-center text-muted-foreground mt-4">
          {mode === "signin" ? "Ainda não tem conta?" : "Já tem conta?"}{" "}
          <button
            onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setError(null); }}
            className="text-primary font-medium hover:underline"
          >
            {mode === "signin" ? "Criar" : "Entrar"}
          </button>
        </div>

        <div className="text-center mt-3">
          <Link to="/" className="text-[11px] text-muted-foreground hover:text-foreground">
            ← Continuar sem entrar
          </Link>
        </div>
        </div>
      </div>
    </div>
  );
}
