import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, Mail, Lock, LogIn } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
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

/** Traduz erros do Google/Supabase em mensagens claras para o usuário. */
function describeGoogleError(raw: string): string {
  const msg = raw.trim();
  if (/provider is not enabled|unsupported provider|validation_failed/i.test(msg)) {
    return "O login com Google ainda não está ativado. No painel do Supabase, vá em Authentication → Providers → Google, ative e informe o Client ID e o Client Secret.";
  }
  if (/redirect|invalid request|403/i.test(msg)) {
    return "O Google recusou o retorno para este endereço. Verifique se a Callback URL do Supabase está cadastrada no cliente OAuth do Google Cloud e se esta página está na lista de Redirect URLs do Supabase.";
  }
  if (/access_denied|has not been granted|test user|org_internal/i.test(msg)) {
    return "Sua conta Google não tem permissão neste aplicativo. No Google Cloud, adicione o seu e-mail em Usuários de teste ou publique o aplicativo.";
  }
  if (/server_error|temporarily unavailable/i.test(msg)) {
    return "O Google não respondeu agora. Tente novamente em alguns instantes.";
  }
  return msg || "Falha ao entrar com Google.";
}

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const oauthError =
      url.searchParams.get("error_description") ||
      url.searchParams.get("error") ||
      hash.get("error_description") ||
      hash.get("error");
    if (oauthError) {
      setError(describeGoogleError(decodeURIComponent(oauthError)));
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

    supabase.auth.getUser().then(({ data }) => {
      if (data.user) navigate({ to: "/" });
    });
  }, [navigate]);


  const handleEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
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
            ? "Confirme o e-mail antes de entrar."
            : msg,
      );
    } finally {
      setBusy(false);
    }
  };


  const handleGoogle = async () => {
    setError(null);
    setBusy(true);
    try {
      const { error, data } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth`,
        },

      });
      if (error) throw error;
      if (data.url) {
        window.location.assign(data.url);
        return;
      }
      navigate({ to: "/" });
    } catch (err) {
      setError(
        describeGoogleError(err instanceof Error ? err.message : "Falha ao entrar com Google"),
      );


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
            {mode === "signin" ? "Entre para sincronizar seus fechamentos" : "Crie sua conta"}
          </div>
        </div>

        <button
          onClick={handleGoogle}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 border border-border rounded-lg py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 mb-4"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continuar com Google
        </button>
        <p className="-mt-3 mb-3 text-[10px] leading-snug text-muted-foreground text-center">
          Se aparecer um aviso do Google, é porque a conta ainda não foi liberada no aplicativo. Você também pode entrar com e-mail abaixo.
        </p>


        <div className="flex items-center gap-2 my-3 text-[10px] uppercase text-muted-foreground">
          <div className="flex-1 h-px bg-border" /> ou <div className="flex-1 h-px bg-border" />
        </div>

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
