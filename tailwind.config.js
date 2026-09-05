import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Die content-Globs relativ zu DIESER Datei auflösen, nicht zum Arbeits-
// verzeichnis des Prozesses. Wird Vite von einem Ordner weiter oben gestartet
// (z.B. `vite DongDo-Stundenzettel`), fand Tailwind sonst keine einzige Datei
// und erzeugte lautlos ein Stylesheet ohne Utilities – die App lief, sah aber
// vollkommen ungestylt aus. Der einzige Hinweis war eine Warnung im Server-Log.
const here = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, "/");

/** @type {import('tailwindcss').Config} */
export default {
  content: [join(here, "index.html").replace(/\\/g, "/"), join(here, "src/**/*.{ts,tsx}").replace(/\\/g, "/")],
  theme: {
    extend: {},
  },
  plugins: [],
};
