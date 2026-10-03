import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "url";

// https://vite.dev/config/
export default defineConfig(async () => ({
  // 生产模式经自定义协议 app:// 加载，资源路径必须相对（file:// 基路径 hack 的替代）
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  worker: {
    // 高亮 Worker 动态 import shiki（代码分割），iife 格式不支持分包，必须用 ES module
    format: "es",
  },
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
  // 固定端口：Electron dev:electron 脚本注入 VITE_DEV_SERVER_URL 指向这里
  server: {
    port: 1420,
    strictPort: true,
  },
}));
