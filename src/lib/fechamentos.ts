import { supabase } from "@/integrations/supabase/client";
import { isSupabaseConfigured } from "@/lib/public-config";

const DEVICE_KEY = "oneopt.device_id";

export function getDeviceId(): string {
  if (typeof window === "undefined") return "ssr";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export type FechamentoTicket = {
  n: number;
  type: string;
  label: string;
  detail: string;
  conf: number;
};

export type FechamentoGame = {
  id: number;
  home: string;
  away: string;
  league?: string;
};

export type Fechamento = {
  id: string;
  device_id: string;
  user_id: string | null;
  name: string;
  target_date: string;
  games: FechamentoGame[];
  tickets: FechamentoTicket[];
  summary: Record<string, unknown>;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
};

async function currentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function listFechamentos(): Promise<Fechamento[]> {
  if (!isSupabaseConfigured()) return [];
  const userId = await currentUserId();
  const deviceId = getDeviceId();
  let query = supabase.from("fechamentos").select("*").order("created_at", { ascending: false });
  if (userId) {
    query = query.eq("user_id", userId);
  } else {
    query = query.is("user_id", null).eq("device_id", deviceId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as Fechamento[];
}

export async function saveFechamento(input: {
  name: string;
  target_date: string;
  games: FechamentoGame[];
  tickets: FechamentoTicket[];
  summary?: Record<string, unknown>;
}): Promise<Fechamento> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase não configurado para salvar o fechamento.");
  }
  const userId = await currentUserId();
  const deviceId = getDeviceId();
  const { data, error } = await supabase
    .from("fechamentos")
    .insert({
      device_id: deviceId,
      user_id: userId,
      name: input.name,
      target_date: input.target_date,
      games: input.games as never,
      tickets: input.tickets as never,
      summary: (input.summary ?? {}) as never,
    })
    .select()
    .single();
  if (error) throw error;
  return data as unknown as Fechamento;
}

export async function deleteFechamento(id: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from("fechamentos").delete().eq("id", id);
  if (error) throw error;
}

export async function renameFechamento(id: string, name: string): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase.from("fechamentos").update({ name }).eq("id", id);
  if (error) throw error;
}

/** Grava o resultado da conferência automática (green/red) no fechamento. */
export async function saveFechamentoCheck(input: {
  id: string;
  summary: Record<string, unknown>;
}): Promise<void> {
  if (!isSupabaseConfigured()) return;
  const { error } = await supabase
    .from("fechamentos")
    .update({ summary: input.summary as never, checked_at: new Date().toISOString() })
    .eq("id", input.id);
  if (error) throw error;
}
