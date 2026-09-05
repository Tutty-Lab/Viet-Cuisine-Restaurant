/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // Die Vercel-Integration von Supabase legt die öffentlichen Schlüssel unter
  // NEXT_PUBLIC_* an (Next.js-Konvention). Dieses Projekt läuft auf Vite, das
  // sonst nur VITE_* an den Browser durchreicht – daher beide Präfixe erlauben.
  // Achtung: NEXT_PUBLIC_*/VITE_* landen im öffentlichen Bundle. Niemals
  // Service-Role-Key oder Postgres-Passwort so benennen.
  envPrefix: ["VITE_", "NEXT_PUBLIC_"],
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Lịch làm việc & Bảng chấm công",
        short_name: "Lịch làm việc",
        description:
          "Tạo lịch làm việc hàng tháng và in bảng chấm công (Stundenzettel) cho cửa hàng ở Đức.",
        lang: "vi",
        dir: "ltr",
        theme_color: "#0f172a",
        background_color: "#f1f5f9",
        display: "standalone",
        orientation: "any",
        start_url: "/",
        scope: "/",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any",
          },
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,woff2}"],
        navigateFallback: "index.html",
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
