import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Tailwind sucht seine Konfiguration sonst ausgehend vom ARBEITSVERZEICHNIS
// des Prozesses. Startet man Vite eine Ebene höher (z.B. `vite DongDo-Stundenzettel`),
// findet es tailwind.config.js nicht, fällt still auf eine Standardkonfiguration
// mit leerem `content` zurück und erzeugt ein Stylesheet ganz ohne Utilities.
// Die App läuft dann, sieht aber vollkommen ungestylt aus – der einzige Hinweis
// ist eine Warnung im Server-Log. Deshalb den Pfad hier explizit angeben.
const here = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: join(here, "tailwind.config.js") },
    autoprefixer: {},
  },
};
