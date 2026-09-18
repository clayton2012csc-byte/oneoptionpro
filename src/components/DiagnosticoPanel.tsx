import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { Bot, Send, Copy, Check, RefreshCw, Activity, Database, Gauge, Sparkles, Trash2, Paperclip, X, FileText, Mic, Square, Video as VideoIcon, AudioLines } from "lucide-react";
import { toast } from "sonner";
import {
  getPlatformSnapshot,
  diagnosticChat,
  listChatMessages,
  saveChatTurn,
  clearChatMessages,
  introMessage,
} from "@/lib/diagnostics.functions";
import { useAuth } from "@/hooks/use-auth";

type Attachment = { name: string; mime: string; dataUrl: string };
type Msg = { role: "user" | "assistant"; content: string; attachments?: Attachment[] };

const MAX_FILES = 4;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_BYTES = 18 * 1024 * 1024;
const ACCEPT = "image/*,application/pdf,video/mp4,video/webm,video/quicktime,audio/*";

const isMedia = (mime: string) => mime.startsWith("video/") || mime.startsWith("audio/");
const allowedType = (mime: string) =>
  mime.startsWith("image/") || mime === "application/pdf" || isMedia(mime);

const readAsDataUrl = (f: File | Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    r.readAsDataURL(f);
  });


function Stat({ icon, label, value, tone = "primary" }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
      <span className={`w-8 h-8 rounded-xl bg-${tone}/15 text-${tone} flex items-center justify-center`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className="text-sm font-black truncate">{value}</div>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: Msg }) {
  const [copied, setCopied] = useState(false);
  const block = m.content.match(/```(?:text|markdown)?\n([\s\S]*?)```/);
  const copy = async () => {
    await navigator.clipboard.writeText(block ? block[1].trim() : m.content);
    setCopied(true);
    toast.success("Prompt copiado — copie para onde quiser.");
    setTimeout(() => setCopied(false), 2000);
  };

  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary/20 border border-primary/30 px-3.5 py-2.5 text-sm space-y-2">
          {!!m.attachments?.length && (
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((a, i) =>
                a.mime.startsWith("image/") ? (
                  <img
                    key={i}
                    src={a.dataUrl}
                    alt={a.name}
                    className="h-24 w-auto max-w-[220px] rounded-xl border border-white/15 object-cover"
                  />
                ) : a.mime.startsWith("video/") ? (
                  <video
                    key={i}
                    src={a.dataUrl}
                    controls
                    playsInline
                    className="h-32 w-auto max-w-[240px] rounded-xl border border-white/15 bg-black object-cover"
                  />
                ) : a.mime.startsWith("audio/") ? (
                  <audio key={i} src={a.dataUrl} controls className="h-9 max-w-[240px]" />
                ) : (
                  <span
                    key={i}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-black/30 border border-white/10 text-[10px]"
                  >
                    <FileText className="w-3.5 h-3.5" /> {a.name}
                  </span>
                ),
              )}
            </div>
          )}
          {m.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2.5">
      <span className="shrink-0 w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center">
        <Bot className="w-4 h-4" />
      </span>
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.04] px-3.5 py-3">
        <div className="prose prose-sm prose-invert max-w-none prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 prose-pre:text-[11px] prose-headings:text-primary prose-headings:text-sm">
          <ReactMarkdown>{m.content}</ReactMarkdown>
        </div>
        <button
          onClick={copy}
          className="mt-2 inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-primary/15 border border-primary/30 text-primary text-[10px] font-bold uppercase tracking-widest hover:bg-primary/25 transition"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {block ? "Copiar prompt" : "Copiar resposta"}
        </button>
      </div>
    </div>
  );
}

export function DiagnosticoPanel() {
  const snapshotFn = useServerFn(getPlatformSnapshot);
  const chatFn = useServerFn(diagnosticChat);
  const historyFn = useServerFn(listChatMessages);
  const saveTurnFn = useServerFn(saveChatTurn);
  const clearFn = useServerFn(clearChatMessages);
  const introFn = useServerFn(introMessage);

  const { user, loading: authLoading } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const [booting, setBooting] = useState(true);
  const endRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);

  const snap = useQuery({
    queryKey: ["platform-snapshot"],
    queryFn: () => snapshotFn(),
    staleTime: 60_000,
    refetchInterval: 600_000,
  });

  const persist = async (turn: Msg[]) => {
    if (!user) return;
    try {
      await saveTurnFn({ data: { messages: turn } });
    } catch (e) {
      // Histórico é best-effort, mas falha silenciosa impede o diagnóstico do problema.
      console.warn("[assistente] não consegui salvar o histórico no banco:", (e as Error).message);
    }
  };

  // Inicialização: carrega o histórico salvo; se estiver vazio, o assistente lê o banco e se apresenta.
  useEffect(() => {
    if (authLoading || bootedRef.current) return;
    bootedRef.current = true;
    (async () => {
      try {
        if (user) {
          const rows = await historyFn();
          if (rows.length) {
            setMessages(rows.map((r) => ({ role: r.role, content: r.content })));
            return;
          }
        }
        const intro = await introFn();
        setMessages([{ role: "assistant", content: intro.text }]);
        await persist([{ role: "assistant", content: intro.text }]);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Falha ao inicializar o assistente.");
      } finally {
        setBooting(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const addFiles = async (list: FileList | File[] | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    const room = MAX_FILES - files.length;
    if (room <= 0) return toast.error(`Máximo de ${MAX_FILES} anexos por mensagem.`);
    const next: Attachment[] = [];
    for (const f of arr.slice(0, room)) {
      const limit = isMedia(f.type) ? MAX_MEDIA_BYTES : MAX_BYTES;
      if (f.size > limit) {
        toast.error(`${f.name} passa de ${Math.round(limit / 1024 / 1024)}MB.`);
        continue;
      }
      if (!allowedType(f.type)) {
        toast.error("Envie imagens (print), PDF, vídeo (.mp4/.webm) ou áudio.");
        continue;
      }
      next.push({ name: f.name || "print.png", mime: f.type, dataUrl: await readAsDataUrl(f) });
    }
    if (next.length) setFiles((p) => [...p, ...next]);
  };

  // ---- Ditado por voz (reconhecimento de fala do navegador) + gravação de áudio ----
  const recognitionRef = useRef<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [listening, setListening] = useState(false);

  const stopVoice = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* noop */
    }
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    setListening(false);
  };

  const startVoice = async () => {
    if (files.length >= MAX_FILES) return toast.error(`Máximo de ${MAX_FILES} anexos por mensagem.`);
    const SR =
      (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;

    // 1) Ditado: transcreve a fala direto no campo de texto.
    if (SR) {
      const rec = new SR();
      rec.lang = "pt-BR";
      rec.continuous = true;
      rec.interimResults = false;
      rec.onresult = (e: any) => {
        let text = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) text += e.results[i][0].transcript;
        }
        if (text.trim()) setInput((p) => (p ? `${p} ${text.trim()}` : text.trim()));
      };
      rec.onerror = () => {
        setListening(false);
        toast.error("Não consegui ouvir. Verifique a permissão do microfone.");
      };
      rec.onend = () => setListening(false);
      recognitionRef.current = rec;
      try {
        rec.start();
        setListening(true);
        toast.success("Gravando: pode falar.");
      } catch {
        setListening(false);
      }
      return;
    }

    // 2) Fallback: grava o áudio e anexa ao chat para a IA ouvir.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        if (blob.size < 2048) return toast.error("Gravação vazia — tente de novo.");
        const ext = mime === "audio/webm" ? "webm" : "m4a";
        setFiles((p) => [...p, { name: `audio-${Date.now()}.${ext}`, mime, dataUrl: "" }].slice(0, MAX_FILES));
        const dataUrl = await readAsDataUrl(blob);
        setFiles((p) => p.map((a) => (a.mime === mime && !a.dataUrl ? { ...a, dataUrl } : a)));
        toast.success("Áudio anexado ao chat.");
      };
      recorderRef.current = rec;
      rec.start();
      setListening(true);
      toast.success("Gravando áudio...");
    } catch {
      toast.error("Não foi possível acessar o microfone.");
    }
  };


  const send = async (text: string) => {
    const clean = text.trim();
    if ((!clean && !files.length) || sending) return;
    const userMsg: Msg = {
      role: "user",
      content: clean || "Analise o print anexado e me diga o que está errado.",
      ...(files.length ? { attachments: files } : {}),
    };
    const next: Msg[] = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setFiles([]);
    setSending(true);
    try {
      // Streaming: a resposta aparece enquanto a IA escreve (nada de tela parada).
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      let full = "";
      if (res.ok && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        setMessages([...next, { role: "assistant", content: "" }]);
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages([...next, { role: "assistant", content: full }]);
        }
      } else {
        // Plano B: chamada tradicional (sem streaming).
        const r = await chatFn({ data: { messages: next.slice(-12) } });
        full = r.text;
        setMessages([...next, { role: "assistant", content: full }]);
      }
      if (!full.trim()) throw new Error("A IA não respondeu. Tente enviar de novo.");
      await persist([
        { role: "user", content: userMsg.attachments?.length ? `${userMsg.content}\n\n[${userMsg.attachments.length} anexo(s) enviado(s)]` : userMsg.content },
        { role: "assistant", content: full },
      ]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao consultar o assistente.");
      setMessages(next);
    } finally {
      setSending(false);
    }
  };


  const clearHistory = async () => {
    try {
      if (user) await clearFn();
      setMessages([]);
      bootedRef.current = false;
      setBooting(true);
      const intro = await introFn();
      setMessages([{ role: "assistant", content: intro.text }]);
      await persist([{ role: "assistant", content: intro.text }]);
      toast.success("Histórico limpo — novo mapeamento gerado.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao limpar o histórico.");
    } finally {
      setBooting(false);
      bootedRef.current = true;
    }
  };

  const s = snap.data;

  return (
    <div className="p-3 sm:p-5 space-y-4">
      <header className="rounded-3xl border border-white/10 bg-gradient-to-br from-primary/10 via-transparent to-emerald-500/10 p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-2xl bg-primary/20 border border-primary/40 text-primary flex items-center justify-center">
            <Bot className="w-5.5 h-5.5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-black tracking-tight">Assistente IA de Diagnóstico & Melhorias</h2>
            <p className="text-xs text-muted-foreground">
              Engenheiro de IA residente: lê o banco real (bilhetes, 11 mercados, cache, rodadas), diagnostica e escreve o prompt
              técnico pronto pra você copiar para onde quiser. Todo o histórico fica salvo no banco.
            </p>
          </div>
          <div className="ml-auto shrink-0 flex items-center gap-2">
            <button
              onClick={clearHistory}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-destructive"
              title="Limpar histórico salvo"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={() => snap.refetch()}
              className="w-9 h-9 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-primary"
              title="Atualizar raio-X do banco"
            >
              <RefreshCw className={`w-4 h-4 ${snap.isFetching ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat
            icon={<Activity className="w-4 h-4" />}
            label="Cobertura 24h"
            value={s ? `${s.tickets.coverage}% · ${s.tickets.ready}/${s.tickets.total24h}` : "—"}
          />
          <Stat
            icon={<Gauge className="w-4 h-4" />}
            label="Assertividade"
            value={s ? `${(s.performance.accuracy * 100).toFixed(1)}% (${s.performance.greens}G/${s.performance.reds}R)` : "—"}
          />
          <Stat icon={<Sparkles className="w-4 h-4" />} label="Mercados avaliados" value={s ? `${s.markets.length}` : "—"} />
          <Stat
            icon={<Database className="w-4 h-4" />}
            label="Cache / snapshots"
            value={s ? `${s.cache.entries} · ${s.scanSnapshots48h}` : "—"}
          />
        </div>
      </header>

      <div className="rounded-3xl border border-white/10 bg-black/20 p-3 sm:p-4">
        <div className="min-h-[220px] max-h-[52vh] overflow-y-auto space-y-3 pr-1">
          {booting && messages.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Lendo o banco e mapeando abas, mercados e estratégias...
            </div>
          )}
          {!user && !authLoading && messages.length > 0 && (
            <p className="text-[11px] text-amber-400/80">
              Você não está logado — o histórico desta conversa não será salvo no banco.
            </p>
          )}
          {messages.map((m, i) => (
            <Bubble key={i} m={m} />
          ))}
          {sending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Analisando o banco e montando o diagnóstico...
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
          className="mt-3 space-y-2"
        >
          {!!files.length && (
            <div className="flex flex-wrap gap-2">
              {files.map((a, i) => (
                <div key={i} className="relative group">
                  {a.mime.startsWith("image/") ? (
                    <img src={a.dataUrl} alt={a.name} className="h-20 w-20 rounded-xl border border-white/15 object-cover" />
                  ) : a.mime.startsWith("video/") ? (
                    <video src={a.dataUrl} muted playsInline className="h-20 w-20 rounded-xl border border-white/15 bg-black object-cover" />
                  ) : (
                    <div className="h-20 w-20 rounded-xl border border-white/15 bg-white/5 flex flex-col items-center justify-center gap-1 px-1">
                      {a.mime.startsWith("audio/") ? (
                        <AudioLines className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <FileText className="w-5 h-5 text-primary" />
                      )}
                      <span className="text-[8px] truncate w-full text-center">{a.name}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                    title="Remover anexo"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              void addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="h-11 w-11 shrink-0 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-muted-foreground hover:text-primary hover:border-primary/40 transition"
            title="Anexar print, PDF, vídeo ou áudio"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => (listening ? stopVoice() : void startVoice())}
            className={`h-11 w-11 shrink-0 rounded-2xl border flex items-center justify-center transition ${
              listening
                ? "bg-destructive/20 border-destructive/50 text-destructive animate-pulse"
                : "bg-white/5 border-white/10 text-muted-foreground hover:text-emerald-400 hover:border-emerald-400/40"
            }`}
            title={listening ? "Parar gravação" : "Falar / gravar áudio"}
          >
            {listening ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter(
                (f) => f.type.startsWith("image/") || f.type === "application/pdf",
              );
              if (imgs.length) {
                e.preventDefault();
                void addFiles(imgs);
                toast.success("Print anexado ao chat.");
              }
            }}
            rows={2}
            placeholder="Descreva o problema ou cole um print (Ctrl+V)..."
            className="flex-1 resize-none rounded-2xl bg-white/5 border border-white/10 px-3.5 py-2.5 text-sm placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/40"
          />
          <button
            type="submit"
            disabled={sending || (!input.trim() && !files.length)}
            className="h-11 px-4 rounded-2xl bg-primary text-primary-foreground text-xs font-bold uppercase tracking-widest inline-flex items-center gap-1.5 disabled:opacity-40"
          >
            <Send className="w-4 h-4" />
            Enviar
          </button>
          </div>
        </form>
      </div>
    </div>
  );
}
