// =============================================================================
// Quick-Chat — Shiki 代码高亮 Worker 队列 + 结果缓存
// =============================================================================
// Shiki 高亮是 WASM 分词计算（每块几到几十毫秒，首次还要初始化引擎）。
// 全部在 Web Worker 里串行执行（见 highlight-worker.ts），主线程不被占用，
// 打开含大量代码块的会话时滚动/首帧绘制不受影响；Worker 不可用时回退到
// 主线程串行队列。结果按 (主题, 语言, 源码) 缓存，重开会话直接命中。
// =============================================================================

const CACHE_LIMIT = 300;
const htmlCache = new Map<string, string>();


interface HighlightJob {
  key: string;
  code: string;
  lang: string;
  dark: boolean;
  cancelled: boolean;
  resolve: (html: string) => void;
  reject: (err: unknown) => void;
}

export interface HighlightRequest {
  promise: Promise<string>;
  cancel: () => void;
}

const queue: HighlightJob[] = [];
let pumping = false;

function readCache(key: string): string | undefined {
  const cached = htmlCache.get(key);
  if (cached !== undefined) {
    // LRU：命中后移到末尾，淘汰时先删最久未命中的
    htmlCache.delete(key);
    htmlCache.set(key, cached);
  }
  return cached;
}

function writeCache(key: string, html: string): void {
  htmlCache.set(key, html);
  if (htmlCache.size > CACHE_LIMIT) {
    const oldest = htmlCache.keys().next().value;
    if (oldest !== undefined) htmlCache.delete(oldest);
  }
}

// ── Worker 通道 ──
let worker: Worker | null | undefined;
let nextJobId = 0;
const inflight = new Map<number, { resolve: (html: string) => void; reject: (err: unknown) => void }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL('./highlight-worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (event: MessageEvent<{ id: number; html?: string; error?: string }>) => {
      const entry = inflight.get(event.data.id);
      if (!entry) return;
      inflight.delete(event.data.id);
      if (event.data.html !== undefined) entry.resolve(event.data.html);
      else entry.reject(new Error(event.data.error ?? 'highlight failed'));
    };
    w.onerror = () => {
      // Worker 运行失败：拒绝在途任务并永久回退到主线程路径
      const pending = [...inflight.values()];
      inflight.clear();
      pending.forEach((entry) => entry.reject(new Error('highlight worker crashed')));
      worker = null;
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function highlightInWorker(code: string, lang: string, dark: boolean): Promise<string> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('worker unavailable'));
  const id = nextJobId++;
  return new Promise<string>((resolve, reject) => {
    inflight.set(id, { resolve, reject });
    w.postMessage({ id, code, lang, dark });
  });
}

// 主线程回退路径（Worker 创建失败时使用）
async function highlightOnMainThread(code: string, lang: string, dark: boolean): Promise<string> {
  const { codeToHtml } = await import('shiki');
  return codeToHtml(code, {
    lang: lang || 'text',
    theme: dark ? 'github-dark-dimmed' : 'github-light',
  });
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    let job = queue.shift();
    while (job) {
      if (job.cancelled) {
        job = queue.shift();
        continue;
      }
      const cached = readCache(job.key);
      if (cached !== undefined) {
        job.resolve(cached);
        job = queue.shift();
        continue;
      }
      try {
        let html: string;
        try {
          html = await highlightInWorker(job.code, job.lang, job.dark);
        } catch {
          html = await highlightOnMainThread(job.code, job.lang, job.dark);
        }
        writeCache(job.key, html);
        if (!job.cancelled) job.resolve(html);
      } catch (e) {
        if (!job.cancelled) job.reject(e);
      }
      job = queue.shift();
    }
  } finally {
    pumping = false;
    // 等待任务期间可能有新任务入队（其 pump() 调用因 pumping 标志被跳过）
    if (queue.length > 0) void pump();
  }
}

export function requestHighlight(code: string, lang: string, dark: boolean): HighlightRequest {
  const key = `${dark ? 'd' : 'l'}|${lang}|${code.length}:${code}`;
  const cached = readCache(key);
  if (cached !== undefined) {
    return { promise: Promise.resolve(cached), cancel: () => undefined };
  }

  const job: HighlightJob = {
    key,
    code,
    lang,
    dark,
    cancelled: false,
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<string>((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });
  queue.push(job);
  void pump();
  return {
    promise,
    cancel: () => {
      job.cancelled = true;
    },
  };
}

let prewarmed = false;

/**
 * 空闲时预热高亮通道：创建 Worker 并触发 shiki 引擎（WASM）初始化。
 * 初始化计算在 Worker 线程完成，不占用主线程；用户打开含代码块的
 * 会话时高亮直接走队列，不再卡在打开后的关键窗口期。
 */
export function prewarmHighlight(): void {
  if (prewarmed) return;
  prewarmed = true;
  void (async () => {
    try {
      await highlightInWorker(' ', 'text', true);
      await highlightInWorker(' ', 'text', false);
    } catch {
      // 预热失败不影响正常使用：首个代码块仍会走正常高亮路径（含主线程回退）
    }
  })();
}
