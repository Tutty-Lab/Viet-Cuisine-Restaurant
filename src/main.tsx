import React from "react";
import ReactDOM from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import App from "./App";
import "./index.css";

// PWA: Service Worker registrieren (Auto-Update, funktioniert offline).
// Die App vom Home-Bildschirm wird von iOS meist nur „aufgeweckt", nicht neu
// gestartet – dann prüft der Browser nie auf eine neue Version. Deshalb selbst
// prüfen: beim Zurückkehren in die App und alle 30 Minuten. Findet sich eine
// neue Version, lädt autoUpdate die Seite von allein neu.
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return;
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") check();
    });
    window.setInterval(check, 30 * 60 * 1000);
  },
});

async function start() {
  // Load a private local snapshot once; subsequent reloads preserve test edits.
  const fixture = import.meta.env.DEV && import.meta.env.VITE_LOCAL_FIXTURE;
  if (fixture && localStorage.getItem("vietcuisine:local-fixture") !== fixture) {
    const response = await fetch(fixture);
    if (!response.ok) throw new Error(`Local fixture: HTTP ${response.status}`);
    const state = await response.json();
    if (!state?.schedule || !Array.isArray(state.schedule.employees)) throw new Error("Invalid local fixture");
    localStorage.setItem("stundenzettel-app:v1:vietcuisine", JSON.stringify(state));
    localStorage.setItem("vietcuisine:local-fixture", fixture);
  }
  ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

}
void start().catch(error => {
  console.error(error);
  document.getElementById("root")!.textContent = "Không nạp được dữ liệu test local. Kiểm tra snapshot rồi tải lại.";
});
