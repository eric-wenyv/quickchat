import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "katex/dist/katex.min.css";
import App from "./App";

if (navigator.userAgent.includes("Linux")) {
  document.documentElement.dataset.platform = "linux";
}

async function showTauriWindowWhenReady() {
  if (!("__TAURI_INTERNALS__" in window)) return;

  window.setTimeout(() => {
    getCurrentWindow().show().catch(() => {});
  }, 0);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void showTauriWindowWhenReady();
