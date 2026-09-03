import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isAndroid, isIos } from "./utils/platform";
import "katex/dist/katex.min.css";
import App from "./App";

// Android UA 同样包含 "Linux"，需先于 Linux 判断
if (isAndroid) {
  document.documentElement.dataset.platform = "android";
} else if (isIos) {
  document.documentElement.dataset.platform = "ios";
} else if (navigator.userAgent.includes("Linux")) {
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
