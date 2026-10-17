import React, { useState, useEffect, useRef, useCallback } from "react";
import AppLayout from "./components/layout/AppLayout";
import { useTheme } from "./hooks/useTheme";
import {
  initDatabase,
  migrateFromLocalStorage,
  getConversations,
  searchConversations,
  getConversation,
  getMessages,
  createConversation,
  updateConversation as dbUpdateConversation,
  deleteConversation as dbDeleteConversation,
  saveMessage,
  updateMessage,
  deleteMessage as dbDeleteMessage,
  getModelConfigs,
  saveModelConfig,
  deleteModelConfig,
  updateModelConfig,
  getSystemPrompts,
  saveSystemPrompt,
  deleteSystemPrompt,
  getThinkingEffortsCache,
  saveThinkingEffortsCache,
  runDatabaseMaintenance,
} from "./services/db";
import { appendCitationList, buildSkillCatalogPrompt, chatCompletion, describeImage, fetchModelThinkingEfforts, generateConversationTitle, generateFallbackConversationTitle, isOpenRouterModel, isPlaceholderConversationTitle, READ_URL_TOOL, ReasoningEffortError, thinkingEffortsKey, USE_SKILL_TOOL, WEB_SEARCH_TOOL } from "./services/ai";
import type { ChatMessage, ChatContentPart, ToolDefinition, ToolCall } from "./services/ai";
import { parseAttachments, getLanguageFromFilename } from "./utils/file";
import { parseImageDescriptions, serializeImageDescriptions, type ImageDescription } from "./utils/image-description";
import { fetchUrlContent, formatUrlContent } from "./services/url";
import { searchWeb, formatSearchResults } from "./services/search";
import { ensureBuiltinSkill, getAutoInvocableSkills, getSkillsSnapshot, readSkill, refreshSkills, type SkillMeta } from "./services/skills";
import {
  getConfiguredGlobalShortcut,
  initializeGlobalShortcut,
  setConfiguredGlobalShortcut,
} from "./services/globalShortcut";
import { isThreadSending, markThreadIdle, markThreadSending, type ThreadSendingState } from "./utils/threadState";
import { prewarmHighlight } from "./utils/code-highlight";
import { isDesktopPlatform } from "./utils/platform";
import { useStableCallback } from "./hooks/useStableCallback";
import type {
  ConversationSummary,
  Conversation,
  Message,
  ModelConfig,
  SystemPrompt,
  ThinkingEfforts,
  UUID,
} from "./types/types";

import "./App.css";

const BUILT_IN_ARTIFACT_PROMPT = [
  'Quick Chat supports sandboxed interactive artifacts in assistant replies.',
  'Artifacts are reserved for explaining genuinely complex problems — multi-step algorithms, intricate protocols, state machines, advanced data structures, or other concepts where a visual or interactive demonstration materially aids understanding that text alone cannot convey clearly.',
  'Do NOT create artifacts for simple questions, straightforward explanations, routine coding tasks, factual lookups, single-step answers, or anything a concise text reply can handle. Default to a normal text answer. Only produce an artifact when the complexity of the problem genuinely warrants it, not merely because the topic falls into a "visualization-friendly" category.',
  'Before creating an artifact, ask yourself: would a reader understand this concept faster and more deeply with an interactive visual than with a well-written text explanation? If the answer is not a clear yes, answer in text instead.',
  'When an artifact is justified, prefer a concise textual explanation plus either a fenced Mermaid diagram for static flow, sequence, state, or process views, or one complete single-file HTML document in a fenced code block with language html when interactivity adds value. Skip the visual only when the user explicitly asks for text only, code only, or no visualization.',
  'When presenting execution order, call chains, request lifecycles, pipelines, flowcharts, sequence diagrams, or state machines, use a fenced mermaid code block instead of ASCII art or box-drawing characters. Choose sequenceDiagram for ordered interactions and flowchart LR/TD for process flows.',
  'Never use inline-code pseudo-diagrams or text layouts made from ASCII/Unicode tree, branch, box, or connector characters (for example ├, └, │, ─, ╰, ╯, →). This includes one-line "field A → field B" chains, class/member trees, and horizontally compressed relationship summaries like `Type ├ field → value └ method() → result`.',
  'Outside of actual source code, use normal Markdown prose with short bullets or a table for structured data. When a visual relationship is genuinely useful, use a fenced Mermaid diagram; otherwise write the relationships as separate wrapped lines. Never put an explanatory diagram or a long structured summary inside single backticks.',
  'Keep Mermaid diagrams compact: use short labels, avoid decorative styling directives, keep branches grouped, and split very large processes into multiple smaller diagrams instead of one oversized chart.',
  'Keep all HTML, CSS, and JavaScript inline. Do not rely on external CDNs, remote scripts, network requests, backend services, local storage, or cookies.',
  'Choose the interaction model to fit the scenario instead of defaulting every artifact to a linear step-through presentation. Never collapse an interactive topic into a passive Next-button slideshow that only advances one fixed script.',
  'Explorable mini-app (the default when interactivity adds value): build one complete, self-contained interactive app the user can operate directly at any moment. Let the user click, hover, and drag the elements of the visualization itself, tune parameters with sliders, selects, number fields, or toggles, edit the data where it helps understanding, and see the visualization respond immediately. The user explores freely in any order instead of following one scripted sequence.',
  'Step-through walkthrough (only when the lesson is a fixed order): reserve it for demonstrating one specific execution trace, an ordered protocol handshake, or a parser consuming one fixed input, where the sequence of transitions itself is what is being taught. Keep Step/Back/Reset compact, make each Step advance exactly one meaningful transition, and still allow direct interaction where meaningful, such as clicking a step marker or table row to jump to it.',
  'Many topics benefit from both at once: a directly manipulable stage plus an optional compact Step control for guided playback. When in doubt, prefer richer direct interaction over more playback buttons.',
  'Seed the app with representative sample data and a meaningful default state so it is useful immediately, then expose only the parameters that genuinely aid exploration. Avoid bloated settings panels, mode pickers, and comparison panels unless they serve the concept.',
  'Do not create an execution log, console log, event feed, or scrolling text transcript by default. Explain state changes in the visual stage itself. Add a log only if the user explicitly asks for one, and then mark the top-level qc-artifact with data-allow-logs="true".',
  'Interactive controls (inputs, forms, sliders, autoplay, and speed controls) are rendered by default. Only set data-allow-inputs="false" or data-allow-autoplay="false" on the top-level qc-artifact for an artifact that should suppress them. If the design calls for larger primary controls, mark it with data-allow-large-controls="true".',
  'Make the artifact useful immediately: include sample data, visible state, labels, compact controls, reset controls, and short status text when they help users inspect the concept.',
  'The artifact is rendered in a borderless host area on a #181818 chat background. Design it as part of the app surface, not as a framed embedded webpage.',
  'Use Quick Chat layout primitives when building artifacts: <main class="qc-artifact"> as the shell (add the qc-step-demo modifier only for step-through walkthroughs), plus .qc-artifact-header, .qc-artifact-layout, .qc-artifact-canvas, .qc-artifact-side, .qc-artifact-controls, .qc-artifact-stats, .qc-artifact-panel, .qc-artifact-badge, and step-demo helpers .qc-step-stage, .qc-step-controls, .qc-step-status, .qc-step-caption, .qc-step-button. These classes are pre-styled by the host.',
  'For step-through demos, use this shape: a small header, one centered .qc-step-stage for the animated concept, compact .qc-step-status chips for current state, and a .qc-step-controls row below the stage. For explorable mini-apps, center the interactive .qc-artifact-canvas and put parameter controls in the .qc-artifact-side rail or a compact .qc-artifact-controls row beside it. Use a side rail only when it materially improves the visual explanation.',
  'If no side rail is needed, use .qc-artifact-layout.qc-single or data-layout="single" and keep the canvas centered. The main diagram must use the available width and be centered horizontally; never pin the visualization to the left while leaving the right side empty.',
  'Keep controls directly beside or below the visualization. Avoid long static tables, large text blocks, and distant footer panels; the interactive stage must remain the primary visual focus.',
  'Use a Claude-like integrated layout: transparent top-level shell, no outer card, panel, border, shadow, or rounded frame around the whole artifact, no browser chrome, no large page header, no full-screen landing hero, and no body/page scrolling.',
  'Internal buttons, inputs, table lines, diagram nodes, and small grouped controls may use subtle borders, but avoid enclosing the entire visualization or every region in heavy cards.',
  'Avoid fixed 100vh layouts, fixed-width desktop-only designs, sticky/fixed overlays, decorative gradients, and excessive padding. Do not override the qc-artifact layout classes with fixed page positioning. The host will resize the frame to content height.',
  'Use the user\'s language for all surrounding explanation and visible artifact text. Only create an artifact when it adds value; otherwise answer normally.',
].join('\n');

const CONVERSATION_LIST_LIMIT = 100;
const MESSAGE_PAGE_SIZE = 120;
// 打开会话时首屏只取最近这么多条：消息正文可能内嵌 base64 图片，
// 一次拉取整页会放大 SQLite IPC 序列化开销。首屏快速渲染后由后台任务补齐到 MESSAGE_PAGE_SIZE。
const INITIAL_MESSAGE_PAGE_SIZE = 30;
// 流式正文刷入 React 状态的最小间隔。SSE 分片远快于人眼感知，
// 每帧都触发整棵消息树重渲 + markdown 重解析是流式卡顿的主因；
// 按该间隔合并刷入可将重渲染频率降低一个数量级，打字机观感不受影响。
const STREAM_FLUSH_INTERVAL_MS = 80;

// -----------------------------------------------------------------------------
// 全局 Error Boundary
// -----------------------------------------------------------------------------
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error: any, info: any) { console.error("UI Error:", error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen w-screen bg-linear-bg text-linear-text-secondary">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-red-400">Something went wrong</h1>
            <p className="text-sm text-linear-text-tertiary">The application encountered a fatal error. Please restart.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-linear-surface rounded-lg text-linear-text-primary font-medium border border-linear-border">Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// -----------------------------------------------------------------------------
// Toast 管理器
// -----------------------------------------------------------------------------
let toastCallback: ((title: string, desc?: string, type?: "error" | "success") => void) | null = null;
const showToast = (title: string, desc?: string, type: "error" | "success" = "error") => {
  if (toastCallback) toastCallback(title, desc, type);
};

// -----------------------------------------------------------------------------
// App
// -----------------------------------------------------------------------------
export default function App() {
  const { theme, toggleTheme, setTheme: setThemeValue } = useTheme();

  // --- 状态 ---
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<UUID | null>(null);
  const [activeModelId, setActiveModelId] = useState<UUID>('');
  const [visionModelId, setVisionModelId] = useState<string | null>(() => localStorage.getItem('quick_chat_vision_model_id') || null);
  const [dbReady, setDbReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSkills, setShowSkills] = useState(false);
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);
  const [globalShortcut, setGlobalShortcut] = useState<string | null>(() => getConfiguredGlobalShortcut());
  // 启动时注册失败（组合键被系统/其他应用占用）→ 设置页内显示黄色警告
  const [globalShortcutError, setGlobalShortcutError] = useState<string | null>(null);

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isSearchingConversations, setIsSearchingConversations] = useState(false);
  const [searchResults, setSearchResults] = useState<ConversationSummary[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [sendingByConversationId, setSendingByConversationId] = useState<ThreadSendingState>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ id: number, title: string, desc?: string, type: "error" | "success" } | null>(null);

  const pendingUpdatesRef = useRef<Record<UUID, string>>({});
  // 思考增量与正文增量并行刷入：reasoning 先于 content 到达，正文未流出时也要驱动 rAF
  const pendingReasoningRef = useRef<Record<UUID, string>>({});
  const pendingUpdateThreadsRef = useRef<Record<UUID, UUID>>({});
  const rafRef = useRef<number | null>(null);
  const abortControllersRef = useRef<Record<UUID, AbortController>>({});
  const activeConversationIdRef = useRef<UUID | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const messagesByConversationRef = useRef<Record<UUID, Message[]>>({});
  const selectRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const initPromiseRef = useRef<Promise<void> | null>(null);
  const initialLoadPromiseRef = useRef<Promise<void> | null>(null);
  const databaseMaintenanceStartedRef = useRef(false);
  // 模型列表镜像：异步流程（loadAll 等）里 setModels 后立即调用 handler 时，
  // 闭包里的 models 还是旧值，统一从 ref 读取
  const modelsRef = useRef<ModelConfig[]>([]);

  // ── per-conversation 状态：思考程度 ──
  const [activeThinkingLevel, setActiveThinkingLevel] = useState<string | null>(null);
  // OpenRouter 模型思考档位元数据缓存（启动时从 DB 整表加载，缺失时按需拉取并持久化）
  const [thinkingEffortsCache, setThinkingEffortsCache] = useState<Record<string, ThinkingEfforts>>({});

  const isSending = isThreadSending(sendingByConversationId, activeConversation?.id);

  useEffect(() => {
    if (!isDesktopPlatform) return;
    void initializeGlobalShortcut().catch(error => {
      console.warn('全局快速打开快捷键未注册:', error);
      setGlobalShortcutError(String(error));
    });
  }, []);

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id ?? null;
  }, [activeConversation?.id]);

  useEffect(() => {
    modelsRef.current = models;
  }, [models]);

  useEffect(() => {
    messagesRef.current = messages;
    if (activeConversation?.id) {
      messagesByConversationRef.current[activeConversation.id] = messages;
    }
  }, [messages, activeConversation?.id]);

  const updateThreadMessages = useCallback((conversationId: UUID, updater: (prev: Message[]) => Message[]) => {
    const base =
      messagesByConversationRef.current[conversationId] ??
      (activeConversationIdRef.current === conversationId ? messagesRef.current : []);
    const next = updater(base);
    messagesByConversationRef.current[conversationId] = next;
    if (activeConversationIdRef.current === conversationId) {
      setMessages(next);
    }
  }, []);

  // 流式增量刷入：rAF 驱动但按 STREAM_FLUSH_INTERVAL_MS 节流。
  // 未到间隔时保持 pending 并预约下一帧重试，因此最后一次变更总会被刷出。
  const lastStreamFlushAtRef = useRef(0);
  const flushPendingStreamUpdates = useCallback(() => {
    rafRef.current = null;
    const contentEntries = Object.entries(pendingUpdatesRef.current);
    const reasoningEntries = Object.entries(pendingReasoningRef.current);
    if (contentEntries.length === 0 && reasoningEntries.length === 0) return;

    if (performance.now() - lastStreamFlushAtRef.current < STREAM_FLUSH_INTERVAL_MS) {
      rafRef.current = window.requestAnimationFrame(flushPendingStreamUpdates);
      return;
    }
    lastStreamFlushAtRef.current = performance.now();

    const conversationIds = new Set<UUID>();
    for (const messageId of [...contentEntries, ...reasoningEntries].map(([id]) => id)) {
      const convId = pendingUpdateThreadsRef.current[messageId];
      if (convId) conversationIds.add(convId);
    }
    for (const pendingConversationId of conversationIds) {
      updateThreadMessages(pendingConversationId, prev => prev.map(msg => {
        const pendingContent = pendingUpdatesRef.current[msg.id];
        const pendingReasoning = pendingReasoningRef.current[msg.id];
        if (pendingContent === undefined && pendingReasoning === undefined) return msg;
        // activity 不在这里派生：pending 正文跨工具轮次保留，若据其清空 activity，
        // 会把工具调用后重新置为 thinking 的状态立刻抹掉。activity 由流式循环在
        // 本轮首个可见正文分片到达时显式清空（见 handleSendMessage）
        return {
          ...msg,
          ...(pendingContent !== undefined
            ? { content: pendingContent, status: 'streaming' as const }
            : {}),
          ...(pendingReasoning !== undefined ? { reasoning_content: pendingReasoning } : {}),
        };
      }));
    }
  }, [updateThreadMessages]);

  // 统一的会话排序：置顶优先，再按最后消息时间降序
  const sortConversations = (convs: ConversationSummary[]) =>
    [...convs].sort((a, b) => {
      if ((b.pinned ?? 0) !== (a.pinned ?? 0)) {
        return (b.pinned ?? 0) - (a.pinned ?? 0);
      }
      return b.last_message_at - a.last_message_at;
    });

  const limitConversationList = (convs: ConversationSummary[]) =>
    sortConversations(convs).slice(0, CONVERSATION_LIST_LIMIT);

  // --- Toast 注册 ---
  useEffect(() => {
    let timer: number;
    toastCallback = (title, desc, type = "error") => {
      setToast({ id: Date.now(), title, desc, type });
      clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 4000);
    };
    return () => { toastCallback = null; clearTimeout(timer); };
  }, []);

  // --- 初始化数据库 & 数据迁移 ---
  useEffect(() => {
    let cancelled = false;
    if (!initPromiseRef.current) {
      initPromiseRef.current = (async () => {
        await initDatabase();
        await migrateFromLocalStorage();
      })();
    }

    initPromiseRef.current
      .then(() => {
        if (cancelled) return;
        setDbReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('数据库初始化失败:', e);
        showToast('数据库初始化失败', String(e));
      });

    return () => { cancelled = true; };
  }, []);

  // --- 数据库就绪后加载数据 ---
  useEffect(() => {
    if (!dbReady) return;

    let cancelled = false;
    let maintenanceTimer: number | null = null;
    if (!initialLoadPromiseRef.current) {
      initialLoadPromiseRef.current = loadAll();
    }

    initialLoadPromiseRef.current.finally(() => {
      if (cancelled || databaseMaintenanceStartedRef.current) return;
      databaseMaintenanceStartedRef.current = true;
      maintenanceTimer = window.setTimeout(() => {
        runDatabaseMaintenance().catch((e) => {
          console.warn('数据库后台维护失败:', e);
        });
      }, 1200);
    });

    return () => {
      cancelled = true;
      if (maintenanceTimer !== null) {
        window.clearTimeout(maintenanceTimer);
      }
    };
  }, [dbReady]);

  const loadAll = async () => {
    setIsLoadingConversations(true);
    try {
      const [convs, mods, prompts, effortsCache] = await Promise.all([
        getConversations(CONVERSATION_LIST_LIMIT, 0),
        getModelConfigs(),
        getSystemPrompts(),
        getThinkingEffortsCache(),
      ]);
      const limitedConversations = limitConversationList(convs);
      setConversations(limitedConversations);
      // 先同步更新 ref：下方 handleSelectConversation / handleCreateConversation
      // 从 ref 读取模型，避免闭包捕获到旧的空 models
      modelsRef.current = mods;
      setModels(mods);
      setSystemPrompts(prompts);
      setThinkingEffortsCache(effortsCache);

      if (mods.length > 0) {
        const def = mods.find(m => m.is_default) || mods[0];
        setActiveModelId(def.id);
      } else {
        // 尝试从 .env 自动创建默认模型
        await seedDefaultModels();
      }

      // 每次启动默认进入新对话，不再恢复上次会话（历史会话从侧边栏手动打开）。
      // --toggle 唤起的已运行实例不重载页面，会话位置天然保留
      handleCreateConversation();
    } catch (e) {
      console.error('加载数据失败:', e);
      showToast('加载数据失败', String(e));
    } finally {
      setIsLoadingConversations(false);
      // 空闲期预热 shiki 高亮引擎：WASM 初始化在主线程上有数百毫秒开销，
      // 提前完成可避免打开含代码块的会话时卡在打开后的关键窗口期
      window.setTimeout(prewarmHighlight, 2000);
    }
  };

  const seedDefaultModels = async () => {
    const now = Date.now();
    const toAdd: ModelConfig[] = [];

    const orKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (orKey) {
      toAdd.push({
        id: crypto.randomUUID(),
        provider: 'openai_compatible',
        model_id: 'google/gemini-3-flash-preview',
        display_name: 'Gemini 3 Flash (OR)',
        api_key: orKey,
        api_endpoint: 'https://openrouter.ai/api/v1/',
        temperature: 0.7,
        max_tokens: null,
        top_p: 0.95,
        thinking_level: null,
        supports_vision: true,
        is_default: toAdd.length === 0,
        created_at: now,
        updated_at: now,
      });
    }

    for (const m of toAdd) {
      await saveModelConfig(m);
    }
    if (toAdd.length > 0) {
      const refreshed = await getModelConfigs();
      modelsRef.current = refreshed;
      setModels(refreshed);
      setActiveModelId(refreshed.find(m => m.is_default)?.id || refreshed[0].id);
      showToast('已加载默认模型', `${toAdd.length} 个模型已自动创建`, 'success');
    }
  };

  // --- 会话全文搜索 ---
  const normalizedSearchQuery = searchQuery.trim();
  const displayedConversations = normalizedSearchQuery ? searchResults : conversations;

  useEffect(() => {
    if (!dbReady) return;

    const requestId = ++searchRequestIdRef.current;
    if (!normalizedSearchQuery) {
      setSearchResults([]);
      setIsSearchingConversations(false);
      return;
    }

    setIsSearchingConversations(true);
    searchConversations(normalizedSearchQuery, CONVERSATION_LIST_LIMIT, 0)
      .then((results) => {
        if (searchRequestIdRef.current !== requestId) return;
        setSearchResults(results);
      })
      .catch((e) => {
        if (searchRequestIdRef.current !== requestId) return;
        console.error('搜索会话失败:', e);
        setSearchResults([]);
        showToast('搜索失败', String(e));
      })
      .finally(() => {
        if (searchRequestIdRef.current === requestId) {
          setIsSearchingConversations(false);
        }
      });
  }, [dbReady, normalizedSearchQuery, conversations]);

  // --- Skills：首次写入内置 Skill 并刷新全局缓存 ---
  useEffect(() => {
    if (!dbReady) return;
    (async () => {
      try {
        await ensureBuiltinSkill();
      } catch (e) {
        console.warn('内置 Skill 初始化失败:', e);
      }
      // 刷新全局 Skill 缓存（/ 命令补全与 AI 自主调用目录共用）
      try {
        await refreshSkills();
      } catch (e) {
        console.warn('加载 Skill 列表失败:', e);
      }
    })();
  }, [dbReady]);

  // --- Skill 管理界面开关 / 在对话中使用 Skill ---
  const handleOpenSkills = useCallback(() => {
    setShowSkills(prev => !prev);
  }, []);

  const handleUseSkill = useCallback((skill: SkillMeta, skillContent: string) => {
    const defaultModel = modelsRef.current.find(m => m.is_default) || modelsRef.current[0];
    if (!defaultModel) {
      showToast('无法创建', '请先配置 AI 模型');
      return;
    }
    const now = Date.now();
    const newConv: Conversation = {
      id: crypto.randomUUID(),
      title: `Skill: ${skill.name}`,
      model_id: defaultModel.id,
      system_prompt: `# Skill: ${skill.name}\n\n${skillContent}\n\n---\n以上是 Skill「${skill.name}」的完整说明，请在后续对话中遵循其中的指引。`,
      thinking_level: defaultModel.thinking_level ?? null,
      last_viewed_message_id: null,
      created_at: now,
      updated_at: now,
    };
    selectRequestIdRef.current += 1;
    setSelectedConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
    setActiveConversation(newConv);
    setActiveModelId(defaultModel.id);
    setActiveThinkingLevel(newConv.thinking_level);
    setMessages([]);
    messagesByConversationRef.current[newConv.id] = [];
    setHasMoreMessages(false);
    setIsLoadingMoreMessages(false);
    setShowSkills(false);
    showToast('已注入 Skill', `「${skill.name}」将作为新对话的上下文`, 'success');
  }, []);

  // --- 会话操作 ---
  const handleSelectConversation = async (id: UUID, summaryOverride?: ConversationSummary) => {
    setShowSkills(false);

    const requestId = ++selectRequestIdRef.current;
    const cachedMessages = messagesByConversationRef.current[id];
    const summary = summaryOverride ?? conversations.find(c => c.id === id);
    const canUseCachedMessages = cachedMessages !== undefined && (
      cachedMessages.length > 0 ||
      (summary?.message_count ?? 0) === 0
    );

    setSelectedConversationId(id);
    setIsLoadingMessages(true);
    setIsLoadingMoreMessages(false);
    setHasMoreMessages(false);
    setMessages(canUseCachedMessages ? cachedMessages : []);
    setHasMoreMessages(canUseCachedMessages ? (summary?.message_count ?? 0) > cachedMessages.length : false);

    if (summary) {
      activeConversationIdRef.current = id;
      setActiveConversation(prev => prev?.id === id ? prev : {
        id,
        title: summary.title,
        model_id: activeModelId,
        system_prompt: null,
        thinking_level: null,
        last_viewed_message_id: null,
        created_at: summary.created_at,
        updated_at: summary.last_message_at,
        pinned: summary.pinned ?? 0,
      });
    }

    try {
      const [convDetail, convMessages] = await Promise.all([
        getConversation(id),
        getMessages(id, INITIAL_MESSAGE_PAGE_SIZE),
      ]);

      if (selectRequestIdRef.current !== requestId) return;

      if (convDetail) {
        activeConversationIdRef.current = convDetail.id;
        setActiveConversation(convDetail);
        // 恢复会话绑定的模型（若模型已被删除则 fallback 到默认模型）
        const convModel = modelsRef.current.find(m => m.id === convDetail.model_id);
        const fallbackModel = modelsRef.current.find(m => m.is_default) || modelsRef.current[0];
        const effectiveModelId = convModel ? convDetail.model_id : (fallbackModel?.id ?? '');
        if (effectiveModelId) setActiveModelId(effectiveModelId);
        // 恢复会话的 thinking_level
        setActiveThinkingLevel(convDetail.thinking_level);
      } else {
        // 会话可能不存在，从列表找摘要信息
        const convs = await getConversations(CONVERSATION_LIST_LIMIT, 0);
        if (selectRequestIdRef.current !== requestId) return;

        setConversations(limitConversationList(convs));
        const s = convs.find(c => c.id === id);
        if (s) {
          activeConversationIdRef.current = id;
          setActiveConversation({
            id,
            title: s.title,
            model_id: activeModelId,
            system_prompt: null,
            thinking_level: null,
            last_viewed_message_id: null,
            created_at: s.created_at,
            updated_at: s.last_message_at,
            pinned: s.pinned ?? 0,
          });
        } else {
          activeConversationIdRef.current = null;
          setSelectedConversationId(null);
          setActiveConversation(null);
        }
      }

      const nextMessages = canUseCachedMessages ? cachedMessages : convMessages;
      setMessages(nextMessages);
      messagesByConversationRef.current[id] = nextMessages;
      const totalMessageCount = summary?.message_count ?? convMessages.length;
      setHasMoreMessages(totalMessageCount > nextMessages.length || (!canUseCachedMessages && convMessages.length === INITIAL_MESSAGE_PAGE_SIZE));

      // 后台补齐首屏之外的历史（最多补到 MESSAGE_PAGE_SIZE），供发送消息时构建
      // 完整上下文。静默 prepend 到列表头部：MessageList 的底部钉住机制保证视口不跳动。
      if (!canUseCachedMessages && convMessages.length === INITIAL_MESSAGE_PAGE_SIZE) {
        const oldestLoadedAt = convMessages[0]?.created_at ?? null;
        void (async () => {
          try {
            const remaining = await getMessages(id, MESSAGE_PAGE_SIZE - INITIAL_MESSAGE_PAGE_SIZE, oldestLoadedAt);
            if (selectRequestIdRef.current !== requestId) return;
            if (remaining.length === 0) {
              // 首屏恰好已是全部历史（如会话正好 30 条）：修正 hasMore，避免空的分页请求
              setHasMoreMessages(totalMessageCount > INITIAL_MESSAGE_PAGE_SIZE);
              return;
            }
            setMessages(prev => {
              if (prev.length === 0 || prev[0]?.conversation_id !== id) return prev;
              const existingIds = new Set(prev.map(m => m.id));
              const prepend = remaining.filter(m => !existingIds.has(m.id));
              if (prepend.length === 0) return prev;
              const merged = [...prepend, ...prev];
              messagesByConversationRef.current[id] = merged;
              return merged;
            });
            setHasMoreMessages(totalMessageCount > INITIAL_MESSAGE_PAGE_SIZE + remaining.length || remaining.length === MESSAGE_PAGE_SIZE - INITIAL_MESSAGE_PAGE_SIZE);
          } catch (e) {
            console.error('后台补齐历史消息失败:', e);
          }
        })();
      }
    } catch (e) {
      if (selectRequestIdRef.current !== requestId) return;
      console.error('加载消息失败:', e);
      showToast('加载消息失败', String(e));
      setSelectedConversationId(activeConversationIdRef.current);
    } finally {
      if (selectRequestIdRef.current === requestId) {
        setIsLoadingMessages(false);
      }
    }
  };

  const handleCreateConversation = useCallback(async () => {
    // 新对话使用默认模型（不是当前活跃模型），fallback 到第一个可用模型
    const defaultModel = modelsRef.current.find(m => m.is_default) || (modelsRef.current[0] ?? {});
    const modelId = defaultModel.id;
    setShowSkills(false);
    // 新对话继承默认模型上一次使用的思考程度（若有思考选择的话）
    const thinkingLevel = defaultModel.thinking_level ?? null;
    // 如果当前已经有一个存在于列表中的空活跃会话，避免重复创建
    const hasEmptyActiveInList =
      activeConversation &&
      messages.length === 0 &&
      conversations.some(c => c.id === activeConversation.id);
    if (hasEmptyActiveInList) return;

    const now = Date.now();
    const newConv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      model_id: modelId,
      system_prompt: null,
      thinking_level: thinkingLevel,
      last_viewed_message_id: null,
      created_at: now,
      updated_at: now,
    };
    selectRequestIdRef.current += 1;
    setSelectedConversationId(newConv.id);
    activeConversationIdRef.current = newConv.id;
    setActiveConversation(newConv);
    setActiveModelId(modelId);
    setActiveThinkingLevel(thinkingLevel);
    setMessages([]);
    messagesByConversationRef.current[newConv.id] = [];
    setHasMoreMessages(false);
    setIsLoadingMoreMessages(false);
  }, [activeConversation, messages, conversations]);

  const handleDeleteConversation = async (id: UUID) => {
    try {
      await dbDeleteConversation(id);
      abortControllersRef.current[id]?.abort();
      delete abortControllersRef.current[id];
      delete messagesByConversationRef.current[id];
      const convs = await getConversations(CONVERSATION_LIST_LIMIT, 0);
      setConversations(limitConversationList(convs));
      if (activeConversation?.id === id) {
        if (convs.length > 0) {
          await handleSelectConversation(convs[0].id);
        } else {
          // 删除最后一个会话后，直接创建新对话，不显示旧版默认页
          handleCreateConversation();
        }
      }
      showToast('已删除', '对话已移除', 'success');
    } catch (e) {
      showToast('删除失败', String(e));
    }
  };

  const handlePinConversation = async (id: UUID) => {
    try {
      const conv = conversations.find(c => c.id === id);
      if (!conv) return;
      const newPinned = conv.pinned ? 0 : 1;
      await dbUpdateConversation(id, { pinned: newPinned });
      const convs = await getConversations(CONVERSATION_LIST_LIMIT, 0);
      setConversations(limitConversationList(convs));
      showToast(newPinned ? '已固定' : '已取消固定', newPinned ? '对话已置顶' : '对话已取消置顶', 'success');
    } catch (e) {
      showToast('操作失败', String(e));
    }
  };

  const handleDeleteMessage = async (msgId: UUID) => {
    try {
      await dbDeleteMessage(msgId);
      setMessages(prev => prev.filter(m => m.id !== msgId));
      // 刷新会话列表（更新消息数和预览）
      const convs = await getConversations(CONVERSATION_LIST_LIMIT, 0);
      setConversations(limitConversationList(convs));
      showToast('已删除', '消息已移除', 'success');
    } catch (e) {
      showToast('删除失败', String(e));
    }
  };

  const handleRenameConversation = async (id: UUID, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    try {
      await dbUpdateConversation(id, { title: trimmed });
      const convs = await getConversations(CONVERSATION_LIST_LIMIT, 0);
      setConversations(limitConversationList(convs));
      if (activeConversation?.id === id) {
        setActiveConversation(prev => prev ? { ...prev, title: trimmed } : prev);
      }
    } catch (e) {
      showToast('重命名失败', String(e));
    }
  };

  const handleUpdateSystemPrompt = async (prompt: string | null) => {
    if (!activeConversation) return;
    try {
      await dbUpdateConversation(activeConversation.id, { system_prompt: prompt });
      setActiveConversation(prev => prev ? { ...prev, system_prompt: prompt } : prev);
      showToast('已更新', '系统提示词已保存', 'success');
    } catch (e) {
      showToast('更新失败', String(e));
    }
  };

  const handleSaveSystemPromptPreset = async (title: string, content: string) => {
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      showToast('保存失败', '提示词内容不能为空');
      return;
    }

    const now = Date.now();
    const existing = systemPrompts.find(p => p.title === trimmedTitle);
    const prompt: SystemPrompt = {
      id: existing?.id ?? crypto.randomUUID(),
      title: trimmedTitle,
      content: trimmedContent,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };

    try {
      await saveSystemPrompt(prompt);
      const refreshed = await getSystemPrompts();
      setSystemPrompts(refreshed);
      showToast('已保存', `预设 "${trimmedTitle}" 已保存`, 'success');
    } catch (e) {
      showToast('保存失败', String(e));
    }
  };

  const handleDeleteSystemPromptPreset = async (id: UUID) => {
    try {
      await deleteSystemPrompt(id);
      setSystemPrompts(prev => prev.filter(p => p.id !== id));
      showToast('已删除', '预设已移除', 'success');
    } catch (e) {
      showToast('删除失败', String(e));
    }
  };

  // --- 切换模型：保存到会话 + 更新 thinking_level ---
  const handleModelSelect = async (modelId: UUID) => {
    setActiveModelId(modelId);
    const newModel = models.find(m => m.id === modelId);
    // 切换模型后，thinking_level 跟随新模型的上次使用值（若支持思考）
    const newThinkingLevel = newModel?.thinking_level ?? null;
    setActiveThinkingLevel(newThinkingLevel);

    if (activeConversation) {
      try {
        await dbUpdateConversation(activeConversation.id, {
          model_id: modelId,
          thinking_level: newThinkingLevel,
        });
        setActiveConversation(prev => prev ? { ...prev, model_id: modelId, thinking_level: newThinkingLevel } : prev);
      } catch (e) {
        console.error('保存模型选择失败:', e);
      }
    }
  };

  // --- 当前模型的思考强度档位 ---
  // OpenRouter：读取持久化的官方元数据缓存（缓存缺失时由下方 useEffect 拉取）；
  // 其余端点的 gemini-3 模型固定三档；其他模型不支持选择档位，选择器隐藏
  const activeModelConfig = models.find(m => m.id === activeModelId) ?? null;
  const activeIsOpenRouter = activeModelConfig ? isOpenRouterModel(activeModelConfig) : false;
  const activeThinkingMeta = activeModelConfig && activeIsOpenRouter
    ? thinkingEffortsCache[thinkingEffortsKey(activeModelConfig)]
    : undefined;
  const activeThinkingEfforts = !activeModelConfig
    ? null
    : activeIsOpenRouter
      ? activeThinkingMeta?.efforts ?? null
      : activeModelConfig.model_id.includes('gemini-3')
        ? ['LOW', 'MEDIUM', 'HIGH']
        : null;

  // 选择器显示值：非 OpenRouter 的 gemini-3 空档位按 MEDIUM 显示（与发送逻辑一致）；
  // OpenRouter 模型的失效选择（不在当前档位列表中）显示为"默认"
  const displayThinkingLevel =
    activeModelConfig && !activeIsOpenRouter && activeModelConfig.model_id.includes('gemini-3')
      ? (activeThinkingLevel ?? 'MEDIUM')
      : activeThinkingLevel && activeThinkingEfforts?.includes(activeThinkingLevel)
        ? activeThinkingLevel
        : null;

  // 缓存缺失时从 OpenRouter 拉取档位元数据并持久化（档位极少变化，拉取失败
  // 保持隐藏，切换模型或重启后重试）
  useEffect(() => {
    if (!activeModelConfig || !activeIsOpenRouter) return;
    const key = thinkingEffortsKey(activeModelConfig);
    if (thinkingEffortsCache[key]) return;
    let cancelled = false;
    fetchModelThinkingEfforts(activeModelConfig)
      .then(meta => {
        if (cancelled || !meta) return;
        setThinkingEffortsCache(prev => ({ ...prev, [key]: meta }));
        saveThinkingEffortsCache(key, meta).catch(e => console.warn('持久化思考强度缓存失败:', e));
      })
      .catch(e => console.warn('获取思考强度元数据失败:', e));
    return () => { cancelled = true; };
  }, [activeModelConfig, activeIsOpenRouter, thinkingEffortsCache]);

  // --- 更新思考程度：per-conversation 持久化 + 更新模型的"上次使用"值 ---
  const handleUpdateThinkingLevel = async (level: string | null) => {
    setActiveThinkingLevel(level);
    if (activeConversation) {
      try {
        await dbUpdateConversation(activeConversation.id, { thinking_level: level });
        setActiveConversation(prev => prev ? { ...prev, thinking_level: level } : prev);
      } catch (e) {
        console.error('保存思考程度失败:', e);
      }
    }
    // 同步更新模型的"上次使用 thinking_level"（供新对话继承）
    if (activeModelId) {
      setModels(prev => prev.map(m => m.id === activeModelId ? { ...m, thinking_level: level } : m));
      try {
        await updateModelConfig(activeModelId, { thinking_level: level });
      } catch (e) {
        console.error('保存模型 thinking_level 失败:', e);
      }
    }
  };

  // --- 将 Message[] 转换为 ChatMessage[] ---
  const IMAGE_MARKDOWN_REGEX = /!\[[^\]]*\]\((data:image\/[^;)]+;base64,[A-Za-z0-9+/=]+)\)/g;

  const buildChatHistory = (conversation: Conversation, currentMessages: Message[], supportsVision: boolean): ChatMessage[] => {
    const history: ChatMessage[] = [];
    history.push({ role: 'system', content: BUILT_IN_ARTIFACT_PROMPT });
    if (conversation.system_prompt?.trim()) {
      history.push({ role: 'system', content: conversation.system_prompt.trim() });
    }
    for (const msg of currentMessages) {
      // 先剥离图片描述注释（不在 UI 显示，但 API 需要时可用）
      const { text: textWithoutImgDesc, descriptions: imgDescriptions } = parseImageDescriptions(msg.content);
      // 再剥离文件附件，分离正文与附件元数据
      const { text: textWithoutAttachments, attachments } = parseAttachments(textWithoutImgDesc);
      const textAttachments = attachments.filter((a) => typeof a.textContent === 'string');
      if (attachments.length > 0) {
        console.log('[buildChatHistory] attachments:', attachments.map(a => ({ name: a.name, hasText: typeof a.textContent === 'string', textLength: a.textContent?.length })));
      }

      // 将文本附件内容拼接到消息正文
      let effectiveContent = textWithoutAttachments;
      if (textAttachments.length > 0) {
        const fileBlocks = textAttachments.map((att) => {
          const lang = getLanguageFromFilename(att.name);
          const fence = lang ? `\`\`\`${lang}` : '\`\`\`';
          return `File: ${att.name}\n${fence}\n${att.textContent}\n\`\`\``;
        });
        const suffix = fileBlocks.join('\n\n');
        effectiveContent = effectiveContent ? `${effectiveContent}\n\n${suffix}` : suffix;
        console.log('[buildChatHistory] effectiveContent length:', effectiveContent.length);
      }

      // 空消息检查：兼容仅含文本附件的消息
      if (!effectiveContent.trim() && msg.role !== 'assistant') continue;

      let content: string | ChatContentPart[] = effectiveContent;

      // 仅 user 消息支持多模态（图片）
      if (msg.role === 'user') {
        const matches = Array.from(effectiveContent.matchAll(IMAGE_MARKDOWN_REGEX));
        if (matches.length > 0) {
          const imageUrls = matches.map((m) => m[1]);
          // 移除图片 Markdown 得到纯文本
          let textOnly = effectiveContent.replace(IMAGE_MARKDOWN_REGEX, '').trim();
          // 去除多余空行
          textOnly = textOnly.replace(/\n{3,}/g, '\n\n');

          if (supportsVision) {
            // 模型支持图片：发送 image_url 内容部分
            const parts: ChatContentPart[] = [];
            if (textOnly) {
              parts.push({ type: 'text', text: textOnly });
            }
            for (const url of imageUrls) {
              parts.push({ type: 'image_url', image_url: { url } });
            }
            content = parts;
          } else if (imgDescriptions.length > 0) {
            // 模型不支持图片：用图片描述文本替代图片
            const descBlocks = imgDescriptions.map((desc) => {
              const preview = desc.url.slice(0, 60);
              return `[图片描述: ${preview}...] ${desc.description}`;
            });
            const descSuffix = descBlocks.join('\n\n');
            content = textOnly ? `${textOnly}\n\n${descSuffix}` : descSuffix;
          }
        }
      }

      const chatMessage: ChatMessage = { role: msg.role as ChatMessage['role'], content };
      if (msg.role === 'assistant' && msg.reasoning_content != null) {
        chatMessage.reasoning_content = msg.reasoning_content;
      }
      history.push(chatMessage);
    }
    return history;
  };

  // --- 发送消息（带 Tool Calling）---
  const handleSendMessage = async (content: string) => {
    if (!content.trim() || !activeConversation || !activeModelId) return;

    const now = Date.now();
    const threadConversation = activeConversation;
    const convId = threadConversation.id;
    setSendingByConversationId(prev => markThreadSending(prev, convId));

    const activeModel = models.find(m => m.id === activeModelId);
    if (!activeModel) {
      showToast('错误', '未找到激活的模型');
      setSendingByConversationId(prev => markThreadIdle(prev, convId));
      return;
    }
    if (!activeModel.api_key) {
      showToast('错误', '模型未配置 API Key');
      setSendingByConversationId(prev => markThreadIdle(prev, convId));
      return;
    }

    // 与选择器显示逻辑一致：非 OpenRouter 的 gemini-3 空档位按 MEDIUM 发送；
    // OpenRouter 模型把选择校验到当前支持的档位（缓存更新后遗留的失效值
    // 不再发送，等价于回到模型默认档位）；其余模型不发送思考强度
    const effectiveThinkingLevel =
      !isOpenRouterModel(activeModel) && activeModel.model_id.includes('gemini-3')
        ? (activeThinkingLevel ?? 'MEDIUM')
        : activeThinkingLevel && activeThinkingEfforts?.includes(activeThinkingLevel)
          ? activeThinkingLevel
          : null;

    // 如果是新会话（未持久化），先保存
    const isExisting = conversations.some(c => c.id === convId);
    if (!isExisting) {
      try {
        await createConversation(threadConversation);
        setConversations(prev => limitConversationList([{
          id: threadConversation.id,
          title: threadConversation.title,
          created_at: threadConversation.created_at,
          last_message_at: now,
          last_message_preview: content.slice(0, 120),
          message_count: 0,
          pinned: 0,
        }, ...prev]));
      } catch (e) {
        showToast('保存会话失败', String(e));
        setSendingByConversationId(prev => markThreadIdle(prev, convId));
        return;
      }
    }

    const userMsgId = crypto.randomUUID();
    const userMsg: Message = {
      id: userMsgId,
      conversation_id: convId,
      role: 'user',
      content,
      status: 'completed',
      token_count: null,
      input_tokens: null,
      output_tokens: null,
      model_id: null,
      created_at: now,
      updated_at: now,
    };

    const aiMsgId = crypto.randomUUID();
    const aiMsg: Message = {
      id: aiMsgId,
      conversation_id: convId,
      role: 'assistant',
      content: '',
      reasoning_content: null,
      thinking_ms: null,
      status: 'streaming',
      token_count: null,
      input_tokens: null,
      output_tokens: null,
      model_id: activeModelId,
      created_at: now + 1,
      updated_at: now + 1,
      activity: { kind: 'thinking', label: '思考中...' },
    };

    const previousThreadMessages = messagesByConversationRef.current[convId] ?? messagesRef.current;

    // 乐观更新 UI
    updateThreadMessages(convId, prev => [...prev, userMsg, aiMsg]);

    // 保存到数据库
    try {
      await saveMessage(userMsg);
      await saveMessage(aiMsg);
    } catch (e) {
      console.error('保存消息失败:', e);
    }

    // 更新会话列表预览
    setConversations(prev => {
      const exists = prev.some(c => c.id === convId);
      const updated = exists
        ? prev.map(c => c.id === convId
          ? { ...c, last_message_preview: content.slice(0, 120), last_message_at: now, message_count: c.message_count + 1 }
          : c
        )
        : [{
          id: convId,
          title: threadConversation.title,
          created_at: threadConversation.created_at,
          last_message_at: now,
          last_message_preview: content.slice(0, 120),
          message_count: 1,
          pinned: 0,
        }, ...prev];
      return limitConversationList(updated);
    });

    // ── 图片描述：当前模型不支持 vision 时，用 vision 模型解析图片 ──
    let effectiveUserContent = content;
    const supportsVision = activeModel.supports_vision;
    if (!supportsVision) {
      const imageMatches = Array.from(content.matchAll(IMAGE_MARKDOWN_REGEX));
      if (imageMatches.length > 0) {
        // 查找用户指定的图片解析模型，fallback 到自动选择第一个 supports_vision 模型
        const visionModel =
          (visionModelId ? models.find(m => m.id === visionModelId && m.supports_vision && m.api_key) : null) ||
          models.find(m => m.supports_vision && m.api_key);
        if (visionModel) {
          const imageUrls = imageMatches.map(m => m[1]);
          const descriptions: ImageDescription[] = [];
          for (const url of imageUrls) {
            try {
              const desc = await describeImage(url, visionModel);
              if (desc) {
                descriptions.push({ url, description: desc });
              }
            } catch (e) {
              console.error('图片描述失败:', e);
            }
          }
          if (descriptions.length > 0) {
            const descSuffix = serializeImageDescriptions(descriptions);
            effectiveUserContent = content + descSuffix;
            // 更新内存中的用户消息（不影响 UI 显示，因为 parseImageDescriptions 会剥离）
            const updatedUserMsg: Message = { ...userMsg, content: effectiveUserContent };
            updateThreadMessages(convId, prev => prev.map(msg =>
              msg.id === userMsgId ? updatedUserMsg : msg
            ));
            // 更新数据库中的用户消息
            try {
              await updateMessage(userMsgId, { content: effectiveUserContent, updated_at: Date.now() });
            } catch (e) {
              console.error('更新图片描述到消息失败:', e);
            }
          }
        }
      }
    }

    // ── 斜杠命令：/skill-id 展开为 Skill 完整指引 ──
    // 指引存入消息内的 HTML 注释（react-markdown 不渲染，UI 只显示 /命令 原文），
    // 因此在整个会话的后续轮次中持续生效。
    const slashMatch = effectiveUserContent.match(/^\/([a-zA-Z0-9_-]+)(?:\s+[\s\S]*)?$/);
    if (slashMatch) {
      const cmd = slashMatch[1].toLowerCase();
      const skill = getSkillsSnapshot().find(
        s => s.id.toLowerCase() === cmd || s.name.toLowerCase() === cmd
      );
      if (skill) {
        try {
          const skillMarkdown = await readSkill(skill.id);
          effectiveUserContent = `${effectiveUserContent}\n\n<!-- skill-context:${skill.id}\n${skillMarkdown}\n-->`;
          const updatedUserMsg: Message = { ...userMsg, content: effectiveUserContent };
          updateThreadMessages(convId, prev => prev.map(msg =>
            msg.id === userMsgId ? updatedUserMsg : msg
          ));
          try {
            await updateMessage(userMsgId, { content: effectiveUserContent, updated_at: Date.now() });
          } catch (e) {
            console.error('写入 Skill 上下文失败:', e);
          }
        } catch (e) {
          console.error('加载 Skill 失败:', e);
          showToast('Skill 加载失败', String(e));
        }
      }
    }

    // 构建对话历史
    let chatHistory = buildChatHistory(threadConversation, [...previousThreadMessages, { ...userMsg, content: effectiveUserContent }], supportsVision);

    // Skill：向系统提示注入 AI 可自主调用的目录（排除 disable-model-invocation），
    // 模型通过 use_skill 工具按需加载完整指引。
    // 发送前重扫一遍：用户可能在应用外手改了 SKILL.md（增删 disable-model-invocation 等），
    // 使改动无需重启即可在本条消息生效；刷新失败则沿用现有快照
    try { await refreshSkills(); } catch { /* keep snapshot */ }
    const autoSkills = getAutoInvocableSkills();
    if (autoSkills.length > 0) {
      chatHistory.splice(1, 0, { role: 'system', content: buildSkillCatalogPrompt(autoSkills) });
    }
    const functionTools: ToolDefinition[] = [];
    // read_url 不依赖搜索开关，始终可用（模型需要时自主抓取网页）
    functionTools.push(READ_URL_TOOL);
    // web_search 由 Tavily 提供，模型需要实时信息时自主搜索
    functionTools.push(WEB_SEARCH_TOOL);
    if (autoSkills.length > 0) functionTools.push(USE_SKILL_TOOL);
    const tools = functionTools.length > 0 ? functionTools : undefined;
    const abortController = new AbortController();
    abortControllersRef.current[convId] = abortController;
    const clearPendingAssistantUpdate = () => {
      delete pendingUpdatesRef.current[aiMsgId];
      delete pendingReasoningRef.current[aiMsgId];
      delete pendingUpdateThreadsRef.current[aiMsgId];
      if (rafRef.current !== null && Object.keys(pendingUpdatesRef.current).length === 0 && Object.keys(pendingReasoningRef.current).length === 0) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    // 提到 try 外：中断（AbortError）时 catch 分支需要用已累积的正文兜底，
    // 避免节流间隔内未刷入 UI/DB 的尾部内容丢失
    let accumulated = '';
    // 当前轮次是否已流出可见正文：每个工具轮次开始时重置，本轮首个可见正文分片
    // 到达时才清空 activity（结束本轮思考展示）。跨轮次判定必须按轮重置——
    // 上一轮的前言正文不能阻止新一轮思考区块进入 live 状态
    let currentRoundTextStarted = false;
    // 思考内容追踪：跨工具轮次累计（每轮 chatCompletion 的 reasoning 分片都经
    // onReasoningDelta 汇入），耗时取"首个思考分片 → 首个正文分片"的间隔
    let accumulatedReasoning = '';
    let reasoningStartAt: number | null = null;
    let thinkingMs: number | null = null;
    const handleReasoningDelta = (delta: string) => {
      if (!delta) return;
      if (reasoningStartAt === null) reasoningStartAt = performance.now();
      accumulatedReasoning += delta;
      pendingReasoningRef.current[aiMsgId] = accumulatedReasoning;
      pendingUpdateThreadsRef.current[aiMsgId] = convId;
      if (rafRef.current === null) {
        rafRef.current = window.requestAnimationFrame(flushPendingStreamUpdates);
      }
    };
    // 思考结束兜底：正文从未流出（空回复/中断）时按"首个思考分片 → 当前"计耗时
    const resolveThinkingMs = (): number | null =>
      thinkingMs ?? (reasoningStartAt !== null ? performance.now() - reasoningStartAt : null);

    try {
      let result = await chatCompletion({
        model: activeModel,
        messages: chatHistory,
        tools,
        thinkingLevel: effectiveThinkingLevel,
        signal: abortController.signal,
        onReasoningDelta: handleReasoningDelta,
      });

      const TOOL_LABELS: Record<string, string> = {
        use_skill: '加载 Skill',
        read_url: '读取网页',
        web_search: '联网搜索',
      };

      // 执行一轮工具调用并把结果写回 chatHistory
      const runToolCalls = async (calls: ToolCall[]) => {
        const toolNames = calls
          .map(tc => TOOL_LABELS[tc.function.name] ?? tc.function.name)
          .join(', ');
        updateThreadMessages(convId, prev => prev.map(msg =>
          msg.id === aiMsgId
            ? { ...msg, activity: { kind: 'tool' as const, label: `正在调用工具: ${toolNames}...` }, status: 'streaming' as const }
            : msg
        ));

        for (const call of calls) {
          let toolResult = '';
          if (call.function.name === 'read_url') {
            try {
              const args = JSON.parse(call.function.arguments || '{}');
              const url = String(args.url || '').trim();
              if (!url) {
                toolResult = '读取网页失败: 未提供有效的 url 参数';
              } else {
                const page = await fetchUrlContent(url);
                toolResult = formatUrlContent(page);
              }
            } catch (e: any) {
              toolResult = `读取网页失败: ${e.message ?? e}`;
            }
          } else if (call.function.name === 'web_search') {
            try {
              const args = JSON.parse(call.function.arguments || '{}');
              const query = String(args.query || '').trim();
              if (!query) {
                toolResult = '搜索失败: 未提供有效的 query 参数';
              } else {
                const results = await searchWeb(query);
                toolResult = formatSearchResults(query, results);
              }
            } catch (e: any) {
              toolResult = `搜索失败: ${e.message ?? e}`;
            }
          } else if (call.function.name === 'use_skill') {
            try {
              const args = JSON.parse(call.function.arguments || '{}');
              const requested = String(args.name || '').trim();
              const skill = autoSkills.find(s => s.id === requested || s.name === requested);
              if (skill) {
                const skillMarkdown = await readSkill(skill.id);
                toolResult = `# Skill: ${skill.name}\n\n${skillMarkdown}\n\n---\n以上是 Skill「${skill.name}」的完整指引，请遵循它回应用户的请求。`;
              } else {
                toolResult = `Skill "${requested}" 不存在或未允许自主调用。可调用的 Skill: ${autoSkills.map(s => s.id).join(', ') || '(无)'}`;
              }
            } catch (e: any) {
              toolResult = `加载 Skill 失败: ${e.message ?? e}`;
            }
          } else {
            toolResult = `未知工具: ${call.function.name}`;
          }

          chatHistory.push({
            role: 'tool',
            content: toolResult,
            tool_call_id: call.id,
          });
        }
      };

      let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

      // 空正文自动补发一次：上游瞬时返回空 completion、或思考模型把 max_tokens 全部
      // 耗在推理阶段（finish_reason=length），都表现为"流正常结束但没有正文"——
      // 这与 API Key 失效不同（那种会在 HTTP 检查处抛"API 请求失败"）。length 截断的
      // 补发放开 max_tokens 上限；工具轮次的 assistant/tool 历史已在 chatHistory 中，
      // 补发等价于带着工具结果再要一次正式回答。
      let generationAttempt = 0;
      while (true) {
        generationAttempt++;

        while (true) {
          // 纯工具调用响应：正文尚未流出，直接进入工具循环
          if (result.type === 'tool_calls') {
            chatHistory.push({
              role: 'assistant',
              content: result.assistantMessage || '',
              tool_calls: result.toolCalls,
              reasoning_content: result.reasoningContent,
            });

            await runToolCalls(result.toolCalls);

            currentRoundTextStarted = false;
            updateThreadMessages(convId, prev => prev.map(msg =>
              msg.id === aiMsgId
                ? { ...msg, activity: { kind: 'thinking' as const, label: '思考中...' }, status: 'streaming' as const }
                : msg
            ));

            result = await chatCompletion({
              model: activeModel,
              messages: chatHistory,
              tools,
              thinkingLevel: effectiveThinkingLevel,
              signal: abortController.signal,
              onReasoningDelta: handleReasoningDelta,
            });
            continue;
          }

          // 流式显示文本回复（增量累加：混合响应跨多轮时正文需要拼接）
          for await (const chunk of result.stream) {
            accumulated += chunk.delta;
            if (chunk.delta) {
              // 首个正文分片到达即思考阶段结束：固化耗时供 ThinkingBlock 展示
              if (thinkingMs === null && reasoningStartAt !== null) {
                thinkingMs = performance.now() - reasoningStartAt;
                updateThreadMessages(convId, prev => prev.map(msg =>
                  msg.id === aiMsgId ? { ...msg, thinking_ms: thinkingMs } : msg
                ));
              }
              // 本轮首个可见正文分片到达：结束本轮思考展示（清空 activity，
              // ThinkingBlock 由 live 转为完成态）。用 trim 后的累计正文判定，
              // 纯空白分片（如引用占位）不提前结束思考展示
              if (!currentRoundTextStarted && accumulated.trim()) {
                currentRoundTextStarted = true;
                updateThreadMessages(convId, prev => prev.map(msg =>
                  msg.id === aiMsgId ? { ...msg, activity: null } : msg
                ));
              }
            }
            pendingUpdatesRef.current[aiMsgId] = accumulated;
            pendingUpdateThreadsRef.current[aiMsgId] = convId;
            if (chunk.usage) {
              lastUsage = chunk.usage;
            }

            if (rafRef.current === null) {
              rafRef.current = window.requestAnimationFrame(flushPendingStreamUpdates);
            }
          }

          // 混合响应：正文流出后模型又触发了工具调用（GLM 等思考模型会先输出一段
          // 前言再调工具）。把已流出的正文连同工具调用写回历史并继续工具循环，
          // 否则工具调用会被静默丢弃、空回复被误报为"返回了空内容"
          if (result.lateToolCalls && result.lateToolCalls.length > 0) {
            chatHistory.push({
              role: 'assistant',
              content: accumulated,
              tool_calls: result.lateToolCalls,
              reasoning_content: result.reasoningContent,
            });

            await runToolCalls(result.lateToolCalls);

            currentRoundTextStarted = false;
            updateThreadMessages(convId, prev => prev.map(msg =>
              msg.id === aiMsgId
                ? { ...msg, activity: { kind: 'thinking' as const, label: '思考中...' }, status: 'streaming' as const }
                : msg
            ));

            result = await chatCompletion({
              model: activeModel,
              messages: chatHistory,
              tools,
              thinkingLevel: effectiveThinkingLevel,
              signal: abortController.signal,
              onReasoningDelta: handleReasoningDelta,
            });
            continue;
          }
          break;
        }

        if (accumulated.trim() || generationAttempt > 1) break;

        accumulated = '';
        currentRoundTextStarted = false;
        result = await chatCompletion({
          model: activeModel,
          messages: chatHistory,
          tools,
          thinkingLevel: effectiveThinkingLevel,
          signal: abortController.signal,
          maxTokens: result.type === 'text' && result.finishReason === 'length' ? null : undefined,
          onReasoningDelta: handleReasoningDelta,
        });
      }

      if (!accumulated.trim()) {
        // 补发后仍为空：报真实原因而不是误导性的"检查 API Key"，
        // 并把已生成的思考内容落库，避免排障线索直接丢失
        const finishReason = result.type === 'text' ? (result.finishReason ?? null) : null;
        const reasoning = accumulatedReasoning || (result.type === 'text' ? result.reasoningContent : '');
        const completionTokens = lastUsage?.completion_tokens ?? result.usage?.completion_tokens ?? null;
        if (reasoning.trim()) {
          const emptyReplyThinkingMs = resolveThinkingMs();
          await updateMessage(aiMsgId, { reasoning_content: reasoning, thinking_ms: emptyReplyThinkingMs, status: 'error' });
          updateThreadMessages(convId, prev => prev.map(msg =>
            msg.id === aiMsgId
              ? { ...msg, reasoning_content: reasoning, thinking_ms: emptyReplyThinkingMs, status: 'error' as const, activity: null }
              : msg
          ));
        }
        let hint: string;
        if (finishReason === 'length') {
          hint = '输出被长度截断（思考阶段耗尽了输出上限，不设上限补发后仍为空），多为模型自身的最大输出限制，请重试或换用输出上限更高的模型。';
        } else if (reasoning.trim()) {
          hint = `模型只输出了思考内容（${reasoning.length} 字符）而未生成正文，多为上游瞬时故障，请重试。`;
        } else if (completionTokens === 0) {
          hint = '上游返回了空回复（completion_tokens=0），多为瞬时故障，请重试。';
        } else {
          hint = `模型未返回任何正文（finish_reason=${finishReason ?? '未知'}，completion_tokens=${completionTokens ?? '未知'}）。`;
        }
        throw new Error(`模型 ${activeModel.model_id} 返回了空内容：${hint}`);
      }

      // 流式完成，更新最终状态
      clearPendingAssistantUpdate();
      const tokenCount = lastUsage?.total_tokens ?? result.usage?.total_tokens ?? null;
      const inputTokens = lastUsage?.prompt_tokens ?? result.usage?.prompt_tokens ?? null;
      const outputTokens = lastUsage?.completion_tokens ?? result.usage?.completion_tokens ?? null;
      const finalContent = appendCitationList(accumulated, result.citations);
      const finalReasoning = accumulatedReasoning || (result.type === 'text' ? result.reasoningContent : '') || null;
      const finalThinkingMs = resolveThinkingMs();
      const finalMsg: Message = {
        ...aiMsg,
        content: finalContent,
        reasoning_content: finalReasoning,
        thinking_ms: finalThinkingMs,
        status: 'completed',
        token_count: tokenCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        updated_at: Date.now(),
        activity: null,
      };
      updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? finalMsg : msg));
      await updateMessage(aiMsgId, {
        content: finalContent,
        reasoning_content: finalReasoning,
        thinking_ms: finalThinkingMs,
        status: 'completed',
        token_count: tokenCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });

      // 更新会话列表
      setConversations(prev => limitConversationList(prev.map(c =>
        c.id === convId
          ? { ...c, last_message_preview: finalContent.slice(0, 120), last_message_at: Date.now(), message_count: c.message_count + 1 }
          : c
      )));

      // 静默生成/更新对话标题（后台执行，模型失败时使用本地兜底）
      (async () => {
        try {
          const titleMessages = [...previousThreadMessages, userMsg, finalMsg].map(m => ({
            role: m.role,
            content: m.content,
          }));

          let newTitle: string | null = null;
          try {
            newTitle = await generateConversationTitle(titleMessages, activeModel);
          } catch (e) {
            console.warn('标题生成失败，使用本地兜底:', e);
          }

          if (!newTitle && isPlaceholderConversationTitle(threadConversation.title)) {
            newTitle = generateFallbackConversationTitle(titleMessages);
          }

          if (newTitle && newTitle !== threadConversation.title) {
            await dbUpdateConversation(convId, { title: newTitle });
            setConversations(prev => limitConversationList(prev.map(c =>
              c.id === convId ? { ...c, title: newTitle } : c
            )));
            if (activeConversationIdRef.current === convId) {
              setActiveConversation(prev => prev ? { ...prev, title: newTitle } : prev);
            }
          }
        } catch (e) {
          console.warn('更新会话标题失败:', e);
        }
      })();

    } catch (e: any) {
      clearPendingAssistantUpdate();
      if (e.name === 'AbortError' || e.message?.toLowerCase()?.includes('abort')) {
        // 用户主动中断，保留当前已生成内容并标记完成。
        // 流式刷入有节流间隔，内存里的 msg.content 可能落后于 accumulated，
        // 用 accumulated 兜底并持久化，避免中断丢失未刷出的尾部（重启后为空）。
        const abortContent = accumulated || undefined;
        const abortReasoning = accumulatedReasoning || null;
        const abortThinkingMs = resolveThinkingMs();
        const abortPatch = {
          ...(abortContent !== undefined ? { content: abortContent } : {}),
          ...(abortReasoning !== null ? { reasoning_content: abortReasoning } : {}),
          ...(abortThinkingMs !== null ? { thinking_ms: abortThinkingMs } : {}),
        };
        updateThreadMessages(convId, prev => prev.map(msg =>
          msg.id === aiMsgId ? { ...msg, ...abortPatch, status: 'completed' as const, activity: null } : msg
        ));
        await updateMessage(aiMsgId, { ...abortPatch, status: 'completed' });
      } else if (e instanceof ReasoningEffortError) {
        clearPendingAssistantUpdate();
        console.error(e);
        // 服务端不再支持所选思考强度：OpenRouter 模型强制重拉元数据、更新持久化缓存，
        // 清掉会话里的失效选择，提示用户重新选择
        let refreshed: ThinkingEfforts | null = null;
        try {
          refreshed = await fetchModelThinkingEfforts(activeModel);
        } catch (fetchErr) {
          console.warn('重新获取思考强度元数据失败:', fetchErr);
        }
        if (refreshed) {
          const key = thinkingEffortsKey(activeModel);
          setThinkingEffortsCache(prev => ({ ...prev, [key]: refreshed! }));
          saveThinkingEffortsCache(key, refreshed).catch(err => console.warn('持久化思考强度缓存失败:', err));
        }
        setActiveThinkingLevel(null);
        try {
          await dbUpdateConversation(convId, { thinking_level: null });
          setActiveConversation(prev => prev?.id === convId ? { ...prev, thinking_level: null } : prev);
        } catch (dbErr) {
          console.error('清除失效思考强度失败:', dbErr);
        }
        updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'error' as const, activity: null } : msg));
        await updateMessage(aiMsgId, { status: 'error' });
        const effortList = refreshed && refreshed.efforts.length > 0
          ? `，当前支持: ${refreshed.efforts.join(' / ')}`
          : '';
        showToast('思考强度已变化', `模型 ${activeModel.model_id} 不再支持当前思考强度${effortList}，请重新选择`, 'error');
      } else {
        console.error(e);
        showToast('AI 流式错误', e.toString(), 'error');
        // 已生成的思考内容同样兜底落库，便于排障与回看
        const errorReasoning = accumulatedReasoning || null;
        const errorThinkingMs = resolveThinkingMs();
        const errorPatch = {
          ...(errorReasoning !== null ? { reasoning_content: errorReasoning } : {}),
          ...(errorThinkingMs !== null ? { thinking_ms: errorThinkingMs } : {}),
        };
        updateThreadMessages(convId, prev => prev.map(msg =>
          msg.id === aiMsgId ? { ...msg, ...errorPatch, status: 'error' as const, activity: null } : msg
        ));
        await updateMessage(aiMsgId, { ...errorPatch, status: 'error' });
      }
    } finally {
      setSendingByConversationId(prev => markThreadIdle(prev, convId));
      clearPendingAssistantUpdate();
      delete abortControllersRef.current[convId];
    }
  };

  const handleStopGeneration = () => {
    const activeId = activeConversationIdRef.current;
    if (activeId && abortControllersRef.current[activeId]) {
      abortControllersRef.current[activeId].abort();
      delete abortControllersRef.current[activeId];
    }
  };

  const handleLoadMoreMessages = async () => {
    const convId = activeConversationIdRef.current;
    if (!convId || isLoadingMoreMessages || !hasMoreMessages) return;

    const currentMessages = messagesByConversationRef.current[convId] ?? messagesRef.current;
    const firstMessage = currentMessages[0];
    if (!firstMessage) {
      setHasMoreMessages(false);
      return;
    }

    setIsLoadingMoreMessages(true);
    try {
      const olderMessages = await getMessages(convId, MESSAGE_PAGE_SIZE, firstMessage.created_at);
      if (activeConversationIdRef.current !== convId) return;

      if (olderMessages.length === 0) {
        setHasMoreMessages(false);
        return;
      }

      setMessages(prev => {
        if (activeConversationIdRef.current !== convId) return prev;
        const existingIds = new Set(prev.map(m => m.id));
        const uniqueOlder = olderMessages.filter(m => !existingIds.has(m.id));
        const next = [...uniqueOlder, ...prev];
        messagesByConversationRef.current[convId] = next;
        return next;
      });
      setHasMoreMessages(olderMessages.length === MESSAGE_PAGE_SIZE);
    } catch (e) {
      console.error('加载更多历史失败:', e);
      showToast('加载更多历史失败', String(e));
    } finally {
      if (activeConversationIdRef.current === convId) {
        setIsLoadingMoreMessages(false);
      }
    }
  };

  // --- 模型设置 ---
  const handleSaveModel = async (config: ModelConfig) => {
    try {
      await saveModelConfig(config);
      const refreshed = await getModelConfigs();
      setModels(refreshed);
      // 若是默认模型，或当前没有任何选中模型，则自动选中
      if (config.is_default || !activeModelId) {
        setActiveModelId(config.id);
      }
      showToast('已保存', '模型配置已更新', 'success');
    } catch (e) {
      showToast('保存失败', String(e));
    }
  };

  const handleDeleteModel = async (id: UUID) => {
    try {
      await deleteModelConfig(id);
      const refreshed = await getModelConfigs();
      setModels(refreshed);
      if (activeModelId === id) {
        const def = refreshed.find(m => m.is_default) || refreshed[0];
        if (def) setActiveModelId(def.id);
        else setActiveModelId('');
      }
      showToast('已删除', '模型已移除', 'success');
    } catch (e) {
      showToast('删除失败', String(e));
    }
  };

  const handleSaveGlobalShortcut = async (shortcut: string | null) => {
    await setConfiguredGlobalShortcut(shortcut);
    setGlobalShortcut(shortcut);
    // 重新保存成功说明注册已恢复（禁用场景下也无须再警告）
    setGlobalShortcutError(null);
  };

  // --- 稳定回调：流式输出期间 messages 高频变化会让上面依赖闭包的 handler
  // 每次渲染都拿到新引用，击穿 memo 化子组件（侧栏/头部/输入区）的浅比较。
  // 这里统一包一层恒定引用的转发器，子组件只在真实数据变化时重渲染。
  const stableSelectConversation = useStableCallback(handleSelectConversation);
  const stableCreateConversation = useStableCallback(handleCreateConversation);
  const stableDeleteConversation = useStableCallback(handleDeleteConversation);
  const stablePinConversation = useStableCallback(handlePinConversation);
  const stableRenameConversation = useStableCallback(handleRenameConversation);
  const stableUpdateSystemPrompt = useStableCallback(handleUpdateSystemPrompt);
  const stableSaveSystemPromptPreset = useStableCallback(handleSaveSystemPromptPreset);
  const stableDeleteSystemPromptPreset = useStableCallback(handleDeleteSystemPromptPreset);
  const stableDeleteMessage = useStableCallback(handleDeleteMessage);
  const stableSendMessage = useStableCallback(handleSendMessage);
  const stableStopGeneration = useStableCallback(handleStopGeneration);
  const stableModelSelect = useStableCallback(handleModelSelect);
  const stableUpdateThinkingLevel = useStableCallback(handleUpdateThinkingLevel);
  const stableOpenSettings = useStableCallback(() => setShowSettings(true));
  const stableCloseSettings = useStableCallback(() => setShowSettings(false));
  const stableSelectVisionModel = useStableCallback((id: string | null) => {
    setVisionModelId(id);
    if (id) localStorage.setItem('quick_chat_vision_model_id', id);
    else localStorage.removeItem('quick_chat_vision_model_id');
  });
  const stableSaveModel = useStableCallback(handleSaveModel);
  const stableDeleteModel = useStableCallback(handleDeleteModel);
  const stableSaveGlobalShortcut = useStableCallback(handleSaveGlobalShortcut);

  // --- 自动创建空对话（就绪后且无活跃会话时）---
  const didAutoCreateRef = useRef(false);
  useEffect(() => {
    if (didAutoCreateRef.current) return;
    if (!dbReady) return;
    if (!activeModelId) return;
    if (activeConversation) return;

    didAutoCreateRef.current = true;
    handleCreateConversation();
  }, [dbReady, activeModelId, activeConversation]);

  // --- 模型自动恢复：若已加载模型但 activeModelId 为空，自动选中第一个 ---
  useEffect(() => {
    if (models.length > 0 && !activeModelId) {
      const def = models.find(m => m.is_default) || models[0];
      setActiveModelId(def.id);
    }
  }, [models, activeModelId]);

  // --- 未就绪遮罩 ---
  if (!dbReady) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-linear-bg text-linear-text-secondary">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-linear-border border-t-linear-text-secondary rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-linear-text-tertiary">正在初始化数据库...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {/* Toast */}
      {toast && (
        <div
          className="fixed top-4 left-1/2 z-[9999] min-w-[168px] max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-in fade-in slide-in-from-top-3"
          role={toast.type === 'error' ? "alert" : "status"}
          aria-live={toast.type === 'error' ? "assertive" : "polite"}
        >
          <div className="relative overflow-hidden rounded-2xl border border-[rgba(255,255,255,0.12)] bg-[#2D2D2D]/95 px-4 py-3 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/10" />
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border ${
                toast.type === 'error'
                  ? 'border-red-400/25 bg-red-500/10 text-red-300'
                  : 'border-emerald-400/25 bg-emerald-500/10 text-emerald-300'
              }`}>
                {toast.type === 'error' ? (
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 8v5" />
                    <path d="M12 17h.01" />
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                  </svg>
                ) : (
                  <svg
                    className="h-3.5 w-3.5 translate-x-[0.5px] translate-y-[0.5px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </div>
              <div className="min-w-[96px] max-w-[18rem]">
                <h3 className="text-[13px] font-semibold leading-5 text-linear-text-primary">{toast.title}</h3>
                {toast.desc && <p className="mt-0.5 break-words text-xs leading-5 text-linear-text-secondary">{toast.desc}</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 设置页由 AppLayout 渲染为全页面视图 */}

      <AppLayout
        theme={theme}
        onToggleTheme={toggleTheme}
        onSetTheme={setThemeValue}
        conversations={displayedConversations}
        activeConversation={activeConversation}
        selectedConversationId={selectedConversationId}
        messages={messages}
        models={models}
        activeModelId={activeModelId}
        isLoadingConversations={isLoadingConversations || isSearchingConversations}
        isSearchingConversations={isSearchingConversations}
        isLoadingMessages={isLoadingMessages}
        isLoadingMoreMessages={isLoadingMoreMessages}
        isSending={isSending}
        hasMoreMessages={hasMoreMessages}
        onSelectConversation={stableSelectConversation}
        onCreateConversation={stableCreateConversation}
        onDeleteConversation={stableDeleteConversation}
        onPinConversation={stablePinConversation}
        onRenameConversation={stableRenameConversation}
        onSearchConversations={setSearchQuery}
        searchQuery={searchQuery}
        onSendMessage={stableSendMessage}
        onLoadMoreMessages={handleLoadMoreMessages}
        onModelSelect={stableModelSelect}
        onUpdateSystemPrompt={stableUpdateSystemPrompt}
        activeThinkingLevel={displayThinkingLevel}
        onUpdateThinkingLevel={stableUpdateThinkingLevel}
        activeThinkingEfforts={activeThinkingEfforts}
        defaultThinkingEffort={activeThinkingMeta?.defaultEffort ?? null}
        onOpenSettings={stableOpenSettings}
        showSettings={showSettings}
        onCloseSettings={stableCloseSettings}
        visionModelId={visionModelId}
        onSelectVisionModel={stableSelectVisionModel}
        globalShortcut={globalShortcut}
        globalShortcutError={globalShortcutError}
        onGlobalShortcutChange={stableSaveGlobalShortcut}
        onSaveModel={stableSaveModel}
        onDeleteModel={stableDeleteModel}
        systemPrompts={systemPrompts}
        onSaveSystemPromptPreset={stableSaveSystemPromptPreset}
        onDeleteSystemPromptPreset={stableDeleteSystemPromptPreset}
        onDeleteMessage={stableDeleteMessage}
        onStopGeneration={stableStopGeneration}
        showSkills={showSkills}
        onOpenSkills={handleOpenSkills}
        onUseSkill={handleUseSkill}
        onNotify={showToast}
      />
    </ErrorBoundary>
  );
}
