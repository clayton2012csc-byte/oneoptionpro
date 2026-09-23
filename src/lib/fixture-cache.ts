import type { ApiFixture } from "@/lib/api-football.functions";

const STORAGE_KEY = "oneoption-fixtures-v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const MAX_FIXTURES = 600;

type StoredFixture = { savedAt: number; fixture: ApiFixture };
type FixtureStore = Record<string, StoredFixture>;

function readStore(): FixtureStore {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
    return parsed && typeof parsed === "object" ? (parsed as FixtureStore) : {};
  } catch {
    return {};
  }
}

function writeStore(store: FixtureStore) {
  if (typeof window === "undefined") return;
  const now = Date.now();
  const entries = Object.entries(store)
    .filter(([, value]) => value?.fixture && now - value.savedAt <= MAX_AGE_MS)
    .sort((a, b) => b[1].savedAt - a[1].savedAt)
    .slice(0, MAX_FIXTURES);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Se o navegador estiver sem espaço, conserva apenas os jogos mais recentes.
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 200))));
    } catch {
      /* cache é uma otimização; a página continua funcionando sem ele */
    }
  }
}

export function cacheFixtures(fixtures: ApiFixture[]) {
  if (typeof window === "undefined" || fixtures.length === 0) return;
  const store = readStore();
  const savedAt = Date.now();
  for (const fixture of fixtures) {
    const id = fixture?.fixture?.id;
    if (Number.isFinite(id)) store[String(id)] = { savedAt, fixture };
  }
  writeStore(store);
}

export function getCachedFixture(id: number): ApiFixture | undefined {
  if (!Number.isFinite(id)) return undefined;
  const entry = readStore()[String(id)];
  if (!entry?.fixture || Date.now() - entry.savedAt > MAX_AGE_MS) return undefined;
  return entry.fixture;
}