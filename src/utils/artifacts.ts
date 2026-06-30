const HTML_DOCUMENT_RE = /<!doctype\s+html|<html[\s>]/i;
const HTML_SHELL_RE = /<head[\s>]|<body[\s>]/i;
const HTML_TAG_RE = /<[a-z!][\s\S]*>/i;
const INTERACTIVE_HTML_RE = /<script[\s>]|<style[\s>]|<canvas[\s>]|<svg[\s>]|<button[\s>]|<input[\s>]|<select[\s>]|<textarea[\s>]|addEventListener\s*\(|\son[a-z]+\s*=/i;

const ARTIFACT_LANGUAGES = new Set([
  'artifact',
  'app',
  'html',
  'htm',
  'interactive',
  'quickchat-artifact',
  'webapp',
]);

const ARTIFACT_CSP = [
  "default-src 'none'",
  "img-src data: blob: http: https:",
  "media-src data: blob: http: https:",
  "font-src data: http: https:",
  "style-src 'unsafe-inline' http: https:",
  "script-src 'unsafe-inline'",
  "connect-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const ARTIFACT_THEME_CSS = `
:root {
  color-scheme: dark;
  --qc-bg: #181818;
  --qc-panel: rgba(255, 255, 255, 0.055);
  --qc-panel-strong: rgba(255, 255, 255, 0.095);
  --qc-border: rgba(255, 255, 255, 0.1);
  --qc-border-strong: rgba(255, 255, 255, 0.18);
  --qc-text: #f4f4f5;
  --qc-body: #dedee3;
  --qc-muted: #8f8f96;
  --qc-accent: #b8c7d9;
  --qc-warn: #d99b2b;
  --qc-pad: clamp(14px, 2vw, 28px);
  --qc-gap: clamp(12px, 1.6vw, 20px);
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--qc-bg) !important;
  color: var(--qc-body) !important;
}
html,
body {
  width: 100% !important;
  min-width: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
  overflow: hidden !important;
  background: var(--qc-bg) !important;
  color: var(--qc-body) !important;
  letter-spacing: 0 !important;
}
*,
*::before,
*::after {
  box-sizing: border-box !important;
}
body {
  line-height: 1.5 !important;
}
body > :first-child {
  width: 100% !important;
  margin-top: 0 !important;
}
body > :where(.app, #app, .container, .wrapper, .page, main, section, article) {
  max-width: 100% !important;
  margin-left: auto !important;
  margin-right: auto !important;
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
}
body > :where(.app, #app, .container, .wrapper, .page, main) {
  min-height: 0 !important;
}
body > :where(.card, .panel, .canvas, .demo, .visualization, .visualizer):only-child {
  background: transparent !important;
  border-color: transparent !important;
  box-shadow: none !important;
}
body :where(.app, .container, .wrapper, .page, main, section, article) {
  max-width: 100% !important;
}
body :where(.qc-artifact) {
  width: 100% !important;
  min-height: clamp(420px, 58vw, 720px);
  display: grid !important;
  grid-template-rows: auto minmax(280px, 1fr) auto;
  gap: var(--qc-gap);
  align-content: stretch;
  padding: var(--qc-pad) !important;
  background: transparent !important;
  border: 0 !important;
  box-shadow: none !important;
}
body :where(.qc-artifact-header) {
  display: flex !important;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px 16px;
  flex-wrap: wrap;
}
body :where(.qc-artifact-heading) {
  min-width: min(100%, 320px);
}
body :where(.qc-artifact-title) {
  margin: 0 !important;
  font-size: clamp(20px, 2vw, 28px) !important;
  font-weight: 700 !important;
  line-height: 1.15 !important;
}
body :where(.qc-artifact-subtitle) {
  margin: 6px 0 0 !important;
  color: var(--qc-muted) !important;
  font-size: 13px !important;
}
body :where(.qc-artifact-badge) {
  display: inline-flex;
  align-items: center;
  min-height: 28px;
  border-radius: 999px;
  border: 1px solid var(--qc-border);
  background: var(--qc-panel);
  color: var(--qc-body);
  padding: 4px 10px;
  font-size: 12px;
  white-space: nowrap;
}
body :where(.qc-artifact-layout) {
  min-width: 0;
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) minmax(260px, 360px);
  gap: clamp(14px, 2vw, 24px);
  align-items: stretch;
}
body :where(.qc-artifact-layout.qc-single),
body :where(.qc-artifact-layout[data-layout="single"]) {
  grid-template-columns: minmax(0, 1fr);
}
body :where(.qc-artifact-canvas) {
  min-width: 0;
  min-height: clamp(280px, 38vw, 540px);
  position: relative;
  display: grid !important;
  place-items: center;
  overflow: hidden;
  background: transparent !important;
}
body :where(.qc-artifact-canvas > svg, .qc-artifact-canvas > canvas) {
  max-width: 100%;
  max-height: min(540px, 62vh);
}
body :where(.qc-artifact-side) {
  min-width: 0;
  display: flex !important;
  flex-direction: column;
  gap: 12px;
  align-self: stretch;
}
body :where(.qc-artifact-panel) {
  border: 1px solid var(--qc-border) !important;
  border-radius: 8px !important;
  background: var(--qc-panel) !important;
  padding: 12px !important;
}
body :where(.qc-artifact-controls),
body :where(.controls, .actions, .toolbar) {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
body :where(.qc-artifact-stats),
body :where(.stats, .metrics) {
  display: flex;
  align-items: stretch;
  flex-wrap: wrap;
  gap: 8px;
}
body :where(.qc-artifact-stat) {
  min-width: 86px;
  border: 1px solid var(--qc-border) !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.035) !important;
  padding: 8px 10px !important;
}
body :where(.qc-artifact-log),
body :where(.log, .logs, .timeline, .events) {
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--qc-border) !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.04) !important;
}
body :where(.stage, .canvas, .visualization, .visualizer, .diagram, .graph, .viewport) {
  max-width: 100%;
  margin-left: auto;
  margin-right: auto;
}
body :where(h1, h2, h3, h4) {
  color: var(--qc-text) !important;
  letter-spacing: 0 !important;
  line-height: 1.2 !important;
}
body :where(p, li, label, span) {
  color: inherit;
}
body :where(a) {
  color: var(--qc-accent);
}
body :where(svg, canvas, img, video) {
  max-width: 100%;
}
body :where(button, input, select, textarea) {
  font: inherit !important;
}
body :where(button) {
  min-height: 34px;
  border: 1px solid var(--qc-border-strong) !important;
  border-radius: 8px !important;
  background: rgba(255, 255, 255, 0.055) !important;
  color: var(--qc-text) !important;
  padding: 6px 12px !important;
  cursor: pointer;
}
body :where(button:hover) {
  background: rgba(255, 255, 255, 0.095) !important;
}
body :where(input, select, textarea) {
  border: 1px solid var(--qc-border) !important;
  border-radius: 8px !important;
  background: #151515 !important;
  color: var(--qc-text) !important;
  padding: 6px 10px !important;
}
body :where(table) {
  border-collapse: collapse;
  color: var(--qc-body) !important;
}
body :where(th, td) {
  border-color: var(--qc-border) !important;
}
body::-webkit-scrollbar,
html::-webkit-scrollbar {
  width: 0 !important;
  height: 0 !important;
}
body :where(.qc-artifact-log, .log, .logs, .timeline, .events)::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
body :where(.qc-artifact-log, .log, .logs, .timeline, .events)::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.14);
  border-radius: 999px;
}
@media (max-width: 760px) {
  body :where(.qc-artifact) {
    min-height: 0;
    padding: 14px 0 !important;
  }
  body :where(.qc-artifact-layout) {
    grid-template-columns: minmax(0, 1fr);
  }
  body :where(.qc-artifact-canvas) {
    min-height: 320px;
  }
  body :where(.qc-artifact-log),
  body :where(.log, .logs, .timeline, .events) {
    max-height: 150px;
  }
}
`;

function artifactRuntimeScript(artifactId: string): string {
  return `<script data-quick-chat-artifact-runtime>
(() => {
  const artifactId = ${JSON.stringify(artifactId)};
  let lastHeight = 0;
  const measure = () => {
    const body = document.body;
    const html = document.documentElement;
    if (!body || !html) return;
    const rectBottom = Array.from(body.children).reduce((bottom, child) => {
      const rect = child.getBoundingClientRect();
      return Math.max(bottom, rect.bottom);
    }, 0);
    const height = Math.ceil(Math.max(
      rectBottom,
      body.scrollHeight,
      body.offsetHeight,
      html.scrollHeight,
      html.offsetHeight,
      260
    ));
    if (Math.abs(height - lastHeight) < 2) return;
    lastHeight = height;
    window.parent.postMessage({ type: 'quick-chat-artifact-size', artifactId, height }, '*');
  };
  const schedule = () => requestAnimationFrame(measure);
  window.addEventListener('load', schedule);
  window.addEventListener('resize', schedule);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(schedule);
    observer.observe(document.documentElement);
    if (document.body) observer.observe(document.body);
  }
  setTimeout(measure, 0);
  setTimeout(measure, 100);
  setTimeout(measure, 500);
})();
</script>`;
}

function artifactHead(): string {
  return [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta http-equiv="Content-Security-Policy" content="${ARTIFACT_CSP}">`,
    `<style data-quick-chat-artifact-theme>${ARTIFACT_THEME_CSS}</style>`,
  ].join('\n');
}

export function normalizeArtifactLanguage(language: string): string {
  return language.trim().toLowerCase();
}

export function isRenderableHtmlArtifact(code: string, language: string): boolean {
  const normalizedLanguage = normalizeArtifactLanguage(language);
  if (!ARTIFACT_LANGUAGES.has(normalizedLanguage)) return false;

  const trimmed = code.trim();
  if (trimmed.length < 80 || !HTML_TAG_RE.test(trimmed)) return false;

  if (HTML_DOCUMENT_RE.test(trimmed)) return true;
  if (normalizedLanguage === 'artifact' || normalizedLanguage === 'quickchat-artifact') {
    return HTML_SHELL_RE.test(trimmed) || INTERACTIVE_HTML_RE.test(trimmed);
  }

  return HTML_SHELL_RE.test(trimmed) || INTERACTIVE_HTML_RE.test(trimmed);
}

function injectIntoHead(documentHtml: string, addition: string): string {
  if (/<\/head>/i.test(documentHtml)) {
    return documentHtml.replace(/<\/head>/i, `${addition}\n</head>`);
  }

  if (/<head[\s>]/i.test(documentHtml)) {
    return documentHtml.replace(/<head([^>]*)>/i, `<head$1>\n${addition}`);
  }

  if (/<html[\s>]/i.test(documentHtml)) {
    return documentHtml.replace(/<html([^>]*)>/i, `<html$1>\n<head>\n${addition}\n</head>`);
  }

  return `<!doctype html>\n<html>\n<head>\n${addition}\n</head>\n<body>\n${documentHtml}\n</body>\n</html>`;
}

function injectRuntime(documentHtml: string, runtime: string): string {
  if (/<\/body>/i.test(documentHtml)) {
    return documentHtml.replace(/<\/body>/i, `${runtime}\n</body>`);
  }

  if (/<\/html>/i.test(documentHtml)) {
    return documentHtml.replace(/<\/html>/i, `${runtime}\n</html>`);
  }

  return `${documentHtml}\n${runtime}`;
}

export function buildArtifactSrcDoc(code: string, artifactId = 'quick-chat-artifact'): string {
  const trimmed = code.trim();
  const head = artifactHead();
  const runtime = artifactRuntimeScript(artifactId);

  if (HTML_DOCUMENT_RE.test(trimmed) || HTML_SHELL_RE.test(trimmed)) {
    return injectRuntime(injectIntoHead(trimmed, head), runtime);
  }

  return `<!doctype html>\n<html>\n<head>\n${head}\n</head>\n<body>\n${trimmed}\n${runtime}\n</body>\n</html>`;
}