import { useSyncExternalStore } from "react";

export type SectionId = "bingao" | "loteca" | "radar" | "beta" | "alfha" | "especiais-betano" | "auditoria" | "diagnostico" | "multiplas";

const KEY = "tdb:pinned-sections";
type Store = Record<SectionId, number[]>;

function empty(): Store {
  return { bingao: [], loteca: [], radar: [], beta: [], alfha: [], "especiais-betano": [], auditoria: [], diagnostico: [], multiplas: [] };
}

function normalize(raw: unknown): Store {
  const base = empty();
  if (!raw || typeof raw !== "object") return base;
  for (const k of ["bingao", "loteca", "radar", "beta", "alfha", "especiais-betano", "auditoria", "diagnostico", "multiplas"] as SectionId[]) {
    const v = (raw as Record<string, unknown>)[k];
    if (Array.isArray(v)) base[k] = v.filter((n) => typeof n === "number");
    else if (typeof v === "number") base[k] = [v];
  }
  return base;
}

function read(): Store {
  if (typeof window === "undefined") return empty();
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : empty();
  } catch {
    return empty();
  }
}

// snapshot estável para SSR (evita loop de render no useSyncExternalStore)
const SERVER_SNAPSHOT: Store = empty();

let state: Store = read();
const listeners = new Set<() => void>();
function emit() { listeners.forEach((l) => l()); }

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {}
}

export function toggleFixture(section: SectionId, fixtureId: number) {
  const list = state[section];
  const next = list.includes(fixtureId) ? list.filter((id) => id !== fixtureId) : [...list, fixtureId];
  state = { ...state, [section]: next };
  persist();
  emit();
}

/** Replace the whole list for a section (used by auto-fill). */
export function setPinnedFixtures(section: SectionId, fixtureIds: number[]) {
  state = { ...state, [section]: Array.from(new Set(fixtureIds)) };
  persist();
  emit();
}

/** Back-compat: null removes all, number replaces the list with that single id. */
export function pinFixture(section: SectionId, fixtureId: number | null) {
  if (fixtureId == null) state = { ...state, [section]: [] };
  else toggleFixture(section, fixtureId);
  if (fixtureId == null) { persist(); emit(); }
}

export function usePinnedSections(): Store {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => state,
    () => SERVER_SNAPSHOT,
  );
}
