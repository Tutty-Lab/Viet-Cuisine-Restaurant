// ============================================================================
// Verbindung zur gemeinsamen Supabase-Datenbank. Alle Filialen hängen an
// derselben Datenbank; getrennt wird über store_id = id der Filiale
// (stores.ts: "shin", "coco").
// ============================================================================

import { createClient } from "@supabase/supabase-js";

/**
 * Präfix vor der Filial-ID, z. B. "test-" => Zeilen "test-kenzo" und
 * "test-asiawok". Nur zum lokalen Arbeiten gegen Testzeilen – in Produktion leer.
 */
export const STORE_ID_PREFIX: string = import.meta.env.VITE_STORE_ID_PREFIX || "";

// Beide Schreibweisen akzeptieren: VITE_* (selbst gesetzt) und NEXT_PUBLIC_*
// (so legt die Vercel-Supabase-Integration die öffentlichen Schlüssel an).
const env = import.meta.env;
const url: string | undefined = env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey: string | undefined =
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

/** true = Zugangsdaten vorhanden. Fehlen sie, läuft die App nur lokal weiter. */
export const isRemoteConfigured = supabase !== null;
