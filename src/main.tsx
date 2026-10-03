import React from "react";
import ReactDOM from "react-dom/client";
import { isElectron, invoke } from "./services/bridge";
import { isLinuxPlatform } from "./utils/platform";
import "katex/dist/katex.min.css";
import App from "./App";

// data-platform 供 CSS 平台特例选择器使用（Linux 不透明底色等）；
// Electron 用 preload 注入的 platform，浏览器回退 UA 嗅探（platform.ts 内）
if (isLinuxPlatform) {
  document.documentElement.dataset.platform = "linux";
}

// Electron 主进程已用 show:false + ready-to-show 避免白屏闪烁；这里仅在
// 桥可用时兜底触发一次 show（对齐旧版桌面壳延迟 show 的时序）。
async function showAppWindowWhenReady() {
  if (!isElectron()) return;

  window.setTimeout(() => {
    invoke("window:show").catch(() => {});
  }, 0);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

void showAppWindowWhenReady();
