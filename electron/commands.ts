// fetch_url
// search_web(Tavily)
// parse_document

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parseHTML } from "linkedom";

// fetch_url

/** 正文返回给模型的最大字符数 */
const FETCH_URL_MAX_CHARS = 20_000;
/** 响应体读取上限 */
const FETCH_URL_MAX_BYTES = 5 * 1024 * 1024;
/** 提出 HTML 中不提供正文语义的标签 */
const HTML_STRIP_SELECTOR = "script, style, noscript, template, svg, iframe, head";
/** 提取文本时在边界补换行，保留基本段落结构 */
const HTML_BLOCK_SELECTOR =
  "p, div, br, hr, li, ul, ol, tr, table, section, article, header, footer, aside, nav, h1, h2, h3, h4, h5, h6, blockquote, pre, figure, figcaption, form, fieldset, dl, dt, dd";

const FETCH_URL_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface UrlContent {
  url: string;
  title: string | null;
  content: string;
  truncated: boolean;
}

/** 收集元素子树的纯文本（Text/CDATA 节点；跳过注释），对齐 scraper 的 text() */
function collectText(node: { childNodes?: ArrayLike<unknown> }): string {
  let out = "";
  const children = node.childNodes;
  for (let i = 0; children && i < children.length; i += 1) {
    const child = children[i] as { nodeType: number; nodeValue?: string | null; childNodes?: ArrayLike<unknown> };
    if (child.nodeType === 3) {
      out += child.nodeValue ?? "";
    } else if (child.nodeType === 1 || child.nodeType === 11) {
      out += collectText(child);
    }
    // 注释（8）与处理指令不参与正文
  }
  return out;
}

/**
 * HTML → (title, 正文文本)。
 * 剔除无正文语义节点后，在块级元素末尾补换行保留段落结构，
 * 行内连续空白折叠为单空格，空行丢弃。
 */
export function extractHtmlText(html: string): { title: string | null; content: string } {
  const { document } = parseHTML(html);

  const titleEl = document.querySelector("title");
  const titleRaw = titleEl ? collectText(titleEl).trim() : "";
  const title = titleRaw.length > 0 ? titleRaw : null;

  // 剔除无正文语义的节点
  const stripEls = Array.from(document.querySelectorAll(HTML_STRIP_SELECTOR)) as Array<Element & { remove(): void }>;
  for (const el of stripEls) {
    el.remove();
  }

  const body = document.querySelector("body");
  if (!body) {
    return { title, content: "" };
  }

  // 在块级元素边界插入换行，再收集纯文本
  const blockEls = Array.from(body.querySelectorAll(HTML_BLOCK_SELECTOR)) as Array<Element>;
  for (const el of blockEls) {
    el.appendChild(document.createTextNode("\n"));
  }

  const raw = collectText(body as unknown as { childNodes?: ArrayLike<unknown> });

  // 行内连续空白折叠为单空格，空行丢弃
  const lines = raw
    .split("\n")
    .map((line) => line.split(/\s+/).join(" ").trim())
    .filter((line) => line.length > 0);
  return { title, content: lines.join("\n") };
}

export async function fetchUrl(rawUrl: string): Promise<UrlContent> {
  const url = rawUrl.trim();
  if (!(url.startsWith("http://") || url.startsWith("https://"))) {
    throw new Error(`仅支持 http/https 链接: ${url}`);
  }

  // 手动跟随重定向（上限 10 次，对齐 reqwest redirect::Policy::limited(10)）
  let current = url;
  let response: Response | null = null;
  for (let redirectCount = 0; ; redirectCount += 1) {
    let attempt: Response;
    try {
      attempt = await fetch(current, {
        headers: { "User-Agent": FETCH_URL_USER_AGENT },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new Error(`请求网页失败: ${(e as Error).message}`);
    }
    if (REDIRECT_STATUSES.has(attempt.status)) {
      if (redirectCount >= 10) {
        throw new Error("请求网页失败: 重定向次数超过限制");
      }
      const location = attempt.headers.get("location");
      if (!location) {
        response = attempt;
        break;
      }
      current = new URL(location, current).toString();
      continue;
    }
    response = attempt;
    break;
  }

  const status = response!.status;
  if (status < 200 || status >= 300) {
    throw new Error(`网页请求失败 (HTTP ${status})`);
  }

  const contentType = (response!.headers.get("content-type") ?? "").toLowerCase();

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await response!.arrayBuffer());
  } catch (e) {
    throw new Error(`读取网页内容失败: ${(e as Error).message}`);
  }
  if (bytes.length > FETCH_URL_MAX_BYTES) {
    bytes = bytes.slice(0, FETCH_URL_MAX_BYTES);
  }
  // from_utf8_lossy 等价：非致命解码，无效字节替换为 U+FFFD
  const rawText = new TextDecoder("utf-8").decode(bytes);

  const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
  const extracted = isHtml
    ? extractHtmlText(rawText)
    : { title: null, content: rawText };

  let content = extracted.content;
  const truncated = Array.from(content).length > FETCH_URL_MAX_CHARS;
  if (truncated) {
    content = Array.from(content).slice(0, FETCH_URL_MAX_CHARS).join("");
  }

  if (content.trim().length === 0) {
    throw new Error("网页内容为空或无法提取正文（可能需要 JS 渲染或登录）");
  }

  return { url, title: extracted.title, content, truncated };
}

// ---------------------------------------------------------------------------
// search_web（Tavily）
// ---------------------------------------------------------------------------

export async function searchWeb(query: string): Promise<unknown> {
  const apiKey = getTavilyApiKey();
  if (apiKey.trim().length === 0) {
    throw new Error("Tavily API Key 未配置，请在项目根目录 .env 中设置 TAVILY_API_KEY");
  }

  let response: Response;
  try {
    response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
      }),
    });
  } catch (e) {
    throw new Error(`Tavily 搜索请求失败: ${(e as Error).message}`);
  }

  const status = response.status;
  const body = await response.text().catch((e) => {
    throw new Error(`Tavily 响应读取失败: ${(e as Error).message}`);
  });

  if (status < 200 || status >= 300) {
    throw new Error(`Tavily 搜索请求失败 (${status}): ${body}`);
  }

  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`Tavily 响应解析失败: ${body.slice(0, 200)}`);
  }
}

/** 依次剥离首尾所有 chars 中的字符（对齐 Rust trim_matches） */
function trimMatches(s: string, chars: string): string {
  let out = s;
  const set = new Set(Array.from(chars));
  while (out.length > 0 && set.has(out[0])) {
    out = out.slice(1);
  }
  while (out.length > 0 && set.has(out[out.length - 1])) {
    out = out.slice(0, -1);
  }
  return out;
}

export function getTavilyApiKey(): string {
  const envValue = process.env.TAVILY_API_KEY;
  if (envValue !== undefined && envValue.trim().length > 0) {
    return envValue.trim();
  }
  const fromDotenv = readDotenvKey("TAVILY_API_KEY");
  if (fromDotenv !== null) {
    return fromDotenv;
  }
  throw new Error("Tavily API Key 未配置，请在项目根目录 .env 中设置 TAVILY_API_KEY");
}

function readDotenvKey(key: string): string | null {
  for (const candidate of dotenvCandidatePaths()) {
    let content: string;
    try {
      content = fs.readFileSync(candidate, "utf8");
    } catch {
      continue;
    }
    for (const rawLine of content.split("\n")) {
      let trimmed = rawLine.trim();
      if (trimmed.length === 0 || trimmed.startsWith("#")) {
        continue;
      }
      if (trimmed.startsWith("export ")) {
        trimmed = trimmed.slice("export ".length).trim();
      }
      const eq = trimmed.indexOf("=");
      if (eq < 0) {
        continue;
      }
      const name = trimmed.slice(0, eq).trim();
      if (name !== key) {
        continue;
      }
      const value = trimMatches(trimMatches(trimmed.slice(eq + 1).trim(), '"'), "'").trim();
      if (value.length > 0) {
        return value;
      }
    }
  }
  return null;
}

function dotenvCandidatePaths(): string[] {
  const paths: string[] = [];
  // 启动目录及其祖先（dev 下即项目根）
  let dir = process.cwd();
  for (; ;) {
    paths.push(path.join(dir, ".env"));
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  // 可执行文件目录及其祖先
  const exeDir = path.dirname(process.execPath);
  let ed = exeDir;
  for (; ;) {
    paths.push(path.join(ed, ".env"));
    const parent = path.dirname(ed);
    if (parent === ed) {
      break;
    }
    ed = parent;
  }
  return paths;
}

// ---------------------------------------------------------------------------
// parse_document（spawn Python：pdfplumber / python-docx）
// ---------------------------------------------------------------------------

const PYTHON_SCRIPT = `
import sys, io, traceback
# Force UTF-8 on Windows to avoid 'gbk' codec errors
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
path = sys.argv[1]
ext = sys.argv[2].lower()

try:
    if ext == 'pdf':
        import pdfplumber
        pdf = pdfplumber.open(path)
        pages = []
        for page in pdf.pages:
            t = page.extract_text()
            pages.append(t if t else '')
        text = '\\n'.join(pages)
        pdf.close()
    elif ext in ('docx', 'doc'):
        from docx import Document
        doc = Document(path)
        text = '\\n'.join(p.text for p in doc.paragraphs)
    else:
        text = ''
    sys.stdout.write(text)
    sys.stdout.flush()
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;

function findPython(): string {
  if (process.platform === "win32") {
    for (const name of ["python", "py", "python3"]) {
      const result = spawnSync("where", [name], { encoding: "utf8" });
      if (result.status === 0) {
        const first = (result.stdout ?? "").split("\n")[0]?.trim();
        if (first && fs.existsSync(first)) {
          return first;
        }
      }
    }
  } else {
    for (const name of ["python3", "python"]) {
      const result = spawnSync("which", [name], { encoding: "utf8" });
      if (result.status === 0) {
        const p = (result.stdout ?? "").trim();
        if (p.length > 0) {
          return p;
        }
      }
    }
  }

  // Fallback: try bare commands
  for (const cmd of ["python3", "python", "py"]) {
    const result = spawnSync(cmd, ["--version"], { encoding: "utf8" });
    if (result.error === undefined && result.status !== null) {
      return cmd;
    }
  }

  throw new Error("无法找到 Python 解释器，请确保 Python 已安装并加入 PATH");
}

export function parseDocument(data: string, ext: string): string {
  let bytes: Buffer;
  try {
    bytes = Buffer.from(data, "base64");
  } catch (e) {
    throw new Error(`base64 decode failed: ${(e as Error).message}`);
  }

  const tempName = `quick_chat_parse_${process.pid}_${Date.now()}`;
  const tempPath = path.join(os.tmpdir(), tempName);

  try {
    fs.writeFileSync(tempPath, bytes);
  } catch (e) {
    throw new Error(`write temp file failed: ${(e as Error).message}`);
  }

  const pythonPath = findPython();

  const output = spawnSync(pythonPath, ["-c", PYTHON_SCRIPT, tempPath, ext], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  try {
    fs.rmSync(tempPath, { force: true });
  } catch {
    // 临时文件清理失败不影响结果
  }

  if (output.error) {
    throw new Error(`启动 Python 失败 (${pythonPath}): ${output.error.message}`);
  }

  const stdout = output.stdout ?? "";
  const stderr = output.stderr ?? "";

  if (output.status === 0) {
    return stdout.trim();
  }
  const code = output.status === null ? "None" : `Some(${output.status})`;
  throw new Error(
    `Python exit code ${code}. stderr: ${stderr.length === 0 ? "(empty)" : stderr}. ` +
    `stdout: ${stdout.length === 0 ? "(empty)" : stdout}. python: ${pythonPath}`,
  );
}
