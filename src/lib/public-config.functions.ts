import { createServerFn } from "@tanstack/react-start";
import type { PublicConfig } from "./public-config";

export const getPublicConfigFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicConfig> => ({
    supabaseUrl: process.env["SUPABASE_URL"] || "",
    supabaseAnonKey: process.env["SUPABASE_PUBLISHABLE_KEY"] || "",
  }),
);
