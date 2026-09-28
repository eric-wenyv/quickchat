// =============================================================================
// Quick-Chat — Shiki 高亮 Worker
// =============================================================================
// shiki 的 WASM 引擎初始化和分词高亮都是 CPU 密集计算，在主线程执行会卡住
// 首帧绘制和滚动。全部移入 Worker：主线程只收发消息，高亮完成前代码块
// 以等宽纯文本展示（见 code-highlight.ts）。
// =============================================================================

interface HighlightJobMessage {
  id: number;
  code: string;
  lang: string;
  dark: boolean;
}

self.onmessage = async (event: MessageEvent<HighlightJobMessage>) => {
  const { id, code, lang, dark } = event.data;
  try {
    const { codeToHtml } = await import('shiki');
    const html = await codeToHtml(code, {
      lang: lang || 'text',
      theme: dark ? 'github-dark-dimmed' : 'github-light',
    });
    self.postMessage({ id, html });
  } catch (e) {
    self.postMessage({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
