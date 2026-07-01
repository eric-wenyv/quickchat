import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    // Mermaid core + shiki oniguruma WASM are intrinsically large even when
    // dynamically imported; raise the threshold so the warning stays meaningful
    // for chunks we can actually control.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // Split stable, long-lived vendor groups so app/code churn doesn't
        // bust the browser cache of the (already large) vendor code.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;

          // React core — virtually every chunk depends on it.
          if (
            id.includes("/node_modules/react/") ||
            id.includes("/node_modules/react-dom/") ||
            id.includes("/node_modules/scheduler/")
          ) {
            return "react-vendor";
          }

          // Markdown pipeline — react-markdown + remark/rehype + micromark.
          if (
            id.includes("/node_modules/react-markdown/") ||
            id.includes("/node_modules/remark-") ||
            id.includes("/node_modules/rehype-") ||
            id.includes("/node_modules/unist-") ||
            id.includes("/node_modules/micromark") ||
            id.includes("/node_modules/mdast-") ||
            id.includes("/node_modules/hast-") ||
            id.includes("/node_modules/unified/") ||
            id.includes("/node_modules/trim-lines/") ||
            id.includes("/node_modules/decode-named-character-reference/")
          ) {
            return "markdown-vendor";
          }

          // KaTeX (JS rendering used by rehype-katex + the global CSS).
          if (
            id.includes("/node_modules/katex/") ||
            id.includes("/node_modules/@types/katex/")
          ) {
            return "katex-vendor";
          }
        },
      },
    },
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
