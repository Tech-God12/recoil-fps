import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), viteSingleFile()],
  server: {
    // Bind on all interfaces: the live preview reaches the dev server from
    // outside the container, so listening on loopback alone is invisible to it.
    host: "0.0.0.0",
    // Allow the sandboxed live-preview host (any *.e2b.app subdomain).
    allowedHosts: [".e2b.app"],
    // The preview is proxied over https on port 443, so the HMR client has to
    // be told where to reconnect - otherwise it dials ws://host:5173 from the
    // user's browser, which is not reachable, and the page sits there broken.
    hmr: { clientPort: 443, protocol: "wss" },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
