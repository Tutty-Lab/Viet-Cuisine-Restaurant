// ============================================================================
// Laden/Speichern des kompletten App-Zustands in der gemeinsamen Datenbank.
// Es wird derselbe JSON-Klumpen abgelegt wie im LocalStorage – dadurch bleibt
// das Datenmodell unverändert und LocalStorage funktioniert weiter als
// Offline-Puffer, falls das Netz weg ist.
// ============================================================================

import type { PersistedState } from "./storage";
import { STORE_ID, isRemoteConfigured, supabase } from "./supabase";

const TABLE = "store_data";

export type RemoteStatus = "off" | "idle" | "saving" | "error";

/** Zustand dieser Filiale holen. null = noch keine Zeile vorhanden. */
export async function loadRemote(): Promise<PersistedState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLE)
    .select("data")
    .eq("store_id", STORE_ID)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return (data?.data as PersistedState | undefined) ?? null;
}

/** Zustand dieser Filiale schreiben (anlegen oder überschreiben). */
export async function saveRemote(state: PersistedState): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase
    .from(TABLE)
    .upsert({ store_id: STORE_ID, data: state }, { onConflict: "store_id" });

  if (error) throw new Error(error.message);
}

export { isRemoteConfigured, STORE_ID };
