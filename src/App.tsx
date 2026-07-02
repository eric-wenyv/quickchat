import React, { useState, useEffect, useRef, useCallback } from "react";
import AppLayout from "./components/layout/AppLayout";
import { useTheme } from "./hooks/useTheme";
import ModelSettings from "./components/settings/ModelSettings";
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
} from "./services/db";
import { appendCitationList, chatCompletion, describeImage, generateConversationTitle, getWebSearchOptions, WEB_SEARCH_TOOL } from "./services/ai";
import type { ChatMessage, ChatContentPart } from "./services/ai";
import { parseAttachments, getLanguageFromFilename } from "./utils/file";
import { parseImageDescriptions, serializeImageDescriptions, type ImageDescription } from "./utils/image-description";
import { searchWeb, formatSearchResults } from "./services/search";
import { isThreadSending, markThreadIdle, markThreadSending, type ThreadSendingState } from "./utils/threadState";
import type {
  ConversationSummary,
  Conversation,
  Message,
  ModelConfig,
  SystemPrompt,
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
  'Keep Mermaid diagrams compact: use short labels, avoid decorative styling directives, keep branches grouped, and split very large processes into multiple smaller diagrams instead of one oversized chart.',
  'Keep all HTML, CSS, and JavaScript inline. Do not rely on external CDNs, remote scripts, network requests, backend services, local storage, or cookies.',
  'For algorithm, parser, state-machine, scheduling, pipeline, and data-structure explanations, default to a compact single-step teaching animation, not a general-purpose simulator.',
  'Use one fixed representative example unless the user explicitly asks for editable input. Do not add custom input fields, source editors, sliders, speed controls, autoplay, mode pickers, comparison panels, or advanced settings by default.',
  'A step visualizer should expose only compact controls: Step/Next and Reset. Make Step advance exactly one meaningful transition and show the result through animation, highlight movement, state chips, pointers, or table-row emphasis.',
  'Do not create an execution log, console log, event feed, or scrolling text transcript by default. Explain state changes in the visual stage itself. Add a log only if the user explicitly asks for one, and then mark the top-level qc-artifact with data-allow-logs="true".',
  'If the user explicitly asks for editable inputs, forms, autoplay, speed controls, or large controls, mark the top-level qc-artifact with data-allow-inputs="true", data-allow-autoplay="true", or data-allow-large-controls="true" as appropriate.',
  'Make the artifact useful immediately: include sample data, visible state, labels, compact step controls, reset controls, and short status text when they help users inspect the concept.',
  'The artifact is rendered in a borderless host area on a #181818 chat background. Design it as part of the app surface, not as a framed embedded webpage.',
  'Use Quick Chat layout primitives when building artifacts: <main class="qc-artifact qc-step-demo">, .qc-artifact-header, .qc-artifact-layout, .qc-artifact-canvas, .qc-artifact-side, .qc-artifact-controls, .qc-artifact-stats, .qc-artifact-panel, .qc-artifact-badge, plus step-demo helpers .qc-step-stage, .qc-step-controls, .qc-step-status, .qc-step-caption, and .qc-step-button. These classes are pre-styled by the host.',
  'For algorithm visualizers, use this default shape: a small header, one centered .qc-step-stage for the animated concept, compact .qc-step-status chips for current state, and a .qc-step-controls row below the stage. Use a side rail only when it materially improves the visual explanation.',
  'If no side rail is needed, use .qc-artifact-layout.qc-single or data-layout="single" and keep the canvas centered. The main diagram must use the available width and be centered horizontally; never pin the visualization to the left while leaving the right side empty.',
  'Keep controls directly beside or below the visualization. Avoid long static tables, large text blocks, and distant footer panels; the animation must remain the primary visual focus.',
  'Use a Claude-like integrated layout: transparent top-level shell, no outer card, panel, border, shadow, or rounded frame around the whole artifact, no browser chrome, no large page header, no full-screen landing hero, and no body/page scrolling.',
  'Internal buttons, inputs, table lines, diagram nodes, and small grouped controls may use subtle borders, but avoid enclosing the entire visualization or every region in heavy cards.',
  'Avoid fixed 100vh layouts, fixed-width desktop-only designs, sticky/fixed overlays, decorative gradients, and excessive padding. Do not override the qc-artifact layout classes with fixed page positioning. The host will resize the frame to content height.',
  'Use the user\'s language for all surrounding explanation and visible artifact text. Only create an artifact when it adds value; otherwise answer normally.',
].join('\n');

const CONVERSATION_LIST_LIMIT = 100;
const MESSAGE_PAGE_SIZE = 120;

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
  const { theme, toggleTheme } = useTheme();

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
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isSearchingConversations, setIsSearchingConversations] = useState(false);
  const [searchResults, setSearchResults] = useState<ConversationSummary[]>([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isLoadingMoreMessages, setIsLoadingMoreMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [sendingByConversationId, setSendingByConversationId] = useState<ThreadSendingState>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ id: number, title: string, desc?: string, type: "error" | "success" } | null>(null);

  // --- Agent 浏览器状态 ---
  const [agentUrl, setAgentUrl] = useState('');
  const [agentMode, setAgentMode] = useState(false);

  const pendingUpdatesRef = useRef<Record<UUID, string>>({});
  const pendingUpdateThreadsRef = useRef<Record<UUID, UUID>>({});
  const rafRef = useRef<number | null>(null);
  const abortControllersRef = useRef<Record<UUID, AbortController>>({});
  const activeConversationIdRef = useRef<UUID | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const messagesByConversationRef = useRef<Record<UUID, Message[]>>({});
  const selectRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);

  // ── per-conversation 状态：思考程度 + 滚动位置 ──
  const [activeThinkingLevel, setActiveThinkingLevel] = useState<'LOW' | 'MEDIUM' | 'HIGH' | null>(null);
  const [scrollRestoreMessageId, setScrollRestoreMessageId] = useState<UUID | null>(null);
  // 每个会话上次查看的消息 ID（内存缓存，切换时快速恢复）
  const conversationScrollMessageIdRef = useRef<Record<UUID, UUID | null>>({});
  // 当前活跃消息 ID（由 MainChatArea 持续上报，切换会话时保存到 ref）
  const activeMessageIdRef = useRef<UUID | null>(null);

  const isSending = isThreadSending(sendingByConversationId, activeConversation?.id);

  useEffect(() => {
    activeConversationIdRef.current = activeConversation?.id ?? null;
  }, [activeConversation?.id]);

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

  // --- Agent 浏览器操作 ---
  const handleOpenAgentBrowser = () => {
    const url = window.prompt('请输入 Agent 服务地址：', 'http://127.0.0.1:5494');
    if (url?.trim()) {
      let finalUrl = url.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl;
      }

      // 创建带 agent_url 的新会话并选中（使用默认模型）
      const defaultModel = models.find(m => m.is_default) || models[0];
      const modelId = defaultModel?.id ?? activeModelId;
      const thinkingLevel = defaultModel?.thinking_level ?? null;
      const now = Date.now();
      const newConv: Conversation = {
        id: crypto.randomUUID(),
        title: finalUrl,
        model_id: modelId,
        system_prompt: null,
        thinking_level: thinkingLevel,
        last_viewed_message_id: null,
        created_at: now,
        updated_at: now,
        agent_url: finalUrl,
      };

      createConversation(newConv)
        .then(() => {
          setConversations(prev => limitConversationList([{
            id: newConv.id,
            title: newConv.title,
            created_at: newConv.created_at,
            last_message_at: now,
            last_message_preview: '',
            message_count: 0,
            agent_url: finalUrl,
            pinned: 0,
          }, ...prev]));
          return handleSelectConversation(newConv.id);
        })
        .catch((e) => {
          console.error('创建 Agent 会话失败:', e);
          showToast('创建失败', String(e));
        });
    }
  };

  const handleAgentUrlChange = async (newUrl: string) => {
    setAgentUrl(newUrl);
    if (activeConversation) {
      try {
        await dbUpdateConversation(activeConversation.id, { agent_url: newUrl });
        setActiveConversation(prev => prev ? { ...prev, agent_url: newUrl } : prev);
        setConversations(prev => limitConversationList(prev.map(c =>
          c.id === activeConversation.id ? { ...c, agent_url: newUrl } : c
        )));
      } catch (e) {
        console.error('更新 Agent URL 失败:', e);
      }
    }
  };

  const handleAgentTitleChange = (_title: string) => {
    // 标题变更由对话本身维护
  };

  const handleExitAgentMode = () => {
    setAgentMode(false);
  };

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
    (async () => {
      try {
        await initDatabase();
        await migrateFromLocalStorage();
        if (cancelled) return;
        setDbReady(true);
      } catch (e) {
        console.error('数据库初始化失败:', e);
        showToast('数据库初始化失败', String(e));
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // --- 数据库就绪后加载数据 ---
  useEffect(() => {
    if (!dbReady) return;
    loadAll();
  }, [dbReady]);

  const loadAll = async () => {
    setIsLoadingConversations(true);
    try {
      const [convs, mods, prompts] = await Promise.all([
        getConversations(CONVERSATION_LIST_LIMIT, 0),
        getModelConfigs(),
        getSystemPrompts(),
      ]);
      setConversations(limitConversationList(convs));
      setModels(mods);
      setSystemPrompts(prompts);

      if (mods.length > 0) {
        const def = mods.find(m => m.is_default) || mods[0];
        setActiveModelId(def.id);
      } else {
        // 尝试从 .env 自动创建默认模型
        await seedDefaultModels();
      }

      // 恢复上次活跃会话，失效时 fallback 到最新会话
      let hasSelectedConversation = false;
      const lastActiveId = localStorage.getItem("quick_chat_last_active_conv");
      if (lastActiveId) {
        const target = convs.find(c => c.id === lastActiveId);
        if (target) {
          await handleSelectConversation(target.id);
          hasSelectedConversation = true;
        } else if (convs.length > 0) {
          await handleSelectConversation(convs[0].id);
          hasSelectedConversation = true;
        }
      } else if (convs.length > 0) {
        await handleSelectConversation(convs[0].id);
        hasSelectedConversation = true;
      }

      // 首次安装或没有任何历史会话时，直接创建一个新对话，不再显示旧版默认欢迎页
      if (!hasSelectedConversation) {
        handleCreateConversation();
      }
    } catch (e) {
      console.error('加载数据失败:', e);
      showToast('加载数据失败', String(e));
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const seedDefaultModels = async () => {
    const now = Date.now();
    const toAdd: ModelConfig[] = [];

    const geminiKey = import.meta.env.VITE_GEMINI_API_KEY;
    if (geminiKey) {
      toAdd.push({
        id: crypto.randomUUID(),
        provider: 'google_gemini',
        model_id: 'gemini-3-flash-preview',
        display_name: 'Gemini 3 Flash',
        api_key: geminiKey,
        api_endpoint: null,
        temperature: 0.7,
        max_tokens: 8192,
        top_p: 0.95,
        thinking_level: 'MEDIUM',
        supports_vision: true,
        is_default: toAdd.length === 0,
        created_at: now,
        updated_at: now,
      });
    }

    const orKey = import.meta.env.VITE_OPENROUTER_API_KEY;
    if (orKey) {
      toAdd.push({
        id: crypto.randomUUID(),
        provider: 'openrouter',
        model_id: 'google/gemini-3-flash-preview',
        display_name: 'Gemini 3 Flash (OR)',
        api_key: orKey,
        api_endpoint: null,
        temperature: 0.7,
        max_tokens: 8192,
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

  // --- 会话操作 ---
  const handleSelectConversation = async (id: UUID) => {
    // 保存即将离开的会话的滚动位置（内存 + DB 持久化）
    const oldConvId = activeConversationIdRef.current;
    if (oldConvId && oldConvId !== id) {
      const lastMsgId = activeMessageIdRef.current;
      conversationScrollMessageIdRef.current[oldConvId] = lastMsgId;
      dbUpdateConversation(oldConvId, { last_viewed_message_id: lastMsgId }).catch(() => {});
    }

    localStorage.setItem("quick_chat_last_active_conv", id);

    const requestId = ++selectRequestIdRef.current;
    const cachedMessages = messagesByConversationRef.current[id];
    const summary = conversations.find(c => c.id === id);
    const canUseCachedMessages = cachedMessages !== undefined && (
      cachedMessages.length > 0 ||
      (summary?.message_count ?? 0) === 0
    );

    setSelectedConversationId(id);
    setIsLoadingMessages(true);
    setIsLoadingMoreMessages(false);
    setHasMoreMessages(false);
    setScrollRestoreMessageId(null);
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
        agent_url: summary.agent_url ?? null,
        pinned: summary.pinned ?? 0,
      });
      if (summary.agent_url) {
        setAgentUrl(summary.agent_url);
        setAgentMode(true);
      } else {
        setAgentMode(false);
      }
    }

    try {
      const [convDetail, convMessages] = await Promise.all([
        getConversation(id),
        getMessages(id, MESSAGE_PAGE_SIZE),
      ]);

      if (selectRequestIdRef.current !== requestId) return;

      if (convDetail) {
        activeConversationIdRef.current = convDetail.id;
        setActiveConversation(convDetail);
        // 恢复会话绑定的模型（若模型已被删除则 fallback 到默认模型）
        const convModel = models.find(m => m.id === convDetail.model_id);
        const fallbackModel = models.find(m => m.is_default) || models[0];
        const effectiveModelId = convModel ? convDetail.model_id : (fallbackModel?.id ?? '');
        if (effectiveModelId) setActiveModelId(effectiveModelId);
        // 恢复会话的 thinking_level
        setActiveThinkingLevel(convDetail.thinking_level);
        // 恢复滚动位置：内存缓存优先，fallback 到 DB 持久化值
        const restoreId = conversationScrollMessageIdRef.current[id] ?? convDetail.last_viewed_message_id ?? null;
        setScrollRestoreMessageId(restoreId);
        // 若会话绑定了 Agent 地址，自动进入 Agent 模式
        if (convDetail.agent_url) {
          setAgentUrl(convDetail.agent_url);
          setAgentMode(true);
        } else {
          setAgentMode(false);
        }
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
            agent_url: s.agent_url ?? null,
            pinned: s.pinned ?? 0,
          });
          setScrollRestoreMessageId(conversationScrollMessageIdRef.current[id] ?? null);
          if (s.agent_url) {
            setAgentUrl(s.agent_url);
            setAgentMode(true);
          } else {
            setAgentMode(false);
          }
        } else {
          activeConversationIdRef.current = null;
          setSelectedConversationId(null);
          setActiveConversation(null);
          setAgentMode(false);
        }
      }

      const nextMessages = canUseCachedMessages ? cachedMessages : convMessages;
      setMessages(nextMessages);
      messagesByConversationRef.current[id] = nextMessages;
      const totalMessageCount = summary?.message_count ?? convMessages.length;
      setHasMoreMessages(totalMessageCount > nextMessages.length || (!canUseCachedMessages && convMessages.length === MESSAGE_PAGE_SIZE));
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
    const defaultModel = models.find(m => m.is_default) || models[0];
    if (!defaultModel) {
      showToast('无法创建', '请先配置 AI 模型');
      return;
    }
    const modelId = defaultModel.id;
    // 新对话继承默认模型上一次使用的思考程度（若有思考选择的话）
    const thinkingLevel = defaultModel.thinking_level ?? null;
    // 如果当前已经有一个存在于列表中的空活跃会话，避免重复创建
    const hasEmptyActiveInList =
      activeConversation &&
      messages.length === 0 &&
      !agentMode &&
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
      agent_url: null,
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
    setScrollRestoreMessageId(null);
    setAgentMode(false);
  }, [models, activeConversation, messages, agentMode, conversations]);

  const handleDeleteConversation = async (id: UUID) => {
    try {
      await dbDeleteConversation(id);
      abortControllersRef.current[id]?.abort();
      delete abortControllersRef.current[id];
      delete messagesByConversationRef.current[id];
      delete conversationScrollMessageIdRef.current[id];
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

  // --- 更新思考程度：per-conversation 持久化 + 更新模型的"上次使用"值 ---
  const handleUpdateThinkingLevel = async (level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => {
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

  // --- 滚动位置上报：MainChatArea 持续更新当前活跃消息 ID ---
  const handleActiveMessageIdChange = useCallback((messageId: UUID | null) => {
    activeMessageIdRef.current = messageId;
  }, []);

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

    // 构建对话历史
    let chatHistory = buildChatHistory(threadConversation, [...previousThreadMessages, { ...userMsg, content: effectiveUserContent }], supportsVision);
    const webSearch = getWebSearchOptions(activeModel);
    const tools = webSearch.enabled && webSearch.mode === 'legacy_tavily' ? [WEB_SEARCH_TOOL] : undefined;
    const abortController = new AbortController();
    abortControllersRef.current[convId] = abortController;
    const clearPendingAssistantUpdate = () => {
      delete pendingUpdatesRef.current[aiMsgId];
      delete pendingUpdateThreadsRef.current[aiMsgId];
      if (rafRef.current !== null && Object.keys(pendingUpdatesRef.current).length === 0) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    try {
      let result = await chatCompletion({
        model: activeModel,
        messages: chatHistory,
        tools,
        webSearch,
        signal: abortController.signal,
      });

      if (webSearch.enabled && webSearch.mode === 'legacy_tavily') {
        let toolLoopCount = 0;
        while (result.type === 'tool_calls' && toolLoopCount < 3) {
          toolLoopCount++;

          const toolNames = result.toolCalls.map(tc => tc.function.name).join(', ');
          updateThreadMessages(convId, prev => prev.map(msg =>
            msg.id === aiMsgId
              ? { ...msg, activity: { kind: 'tool' as const, label: `正在调用工具: ${toolNames}...` }, status: 'streaming' as const }
              : msg
          ));

          chatHistory.push({
            role: 'assistant',
            content: result.assistantMessage || '',
            tool_calls: result.toolCalls,
            reasoning_content: result.reasoningContent,
          });

          for (const call of result.toolCalls) {
            let toolResult = '';
            if (call.function.name === 'web_search') {
              try {
                const args = JSON.parse(call.function.arguments || '{}');
                const query = args.query || content;
                const searchResults = await searchWeb(query);
                toolResult = formatSearchResults(query, searchResults);
              } catch (e: any) {
                toolResult = `搜索失败: ${e.message}`;
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

          updateThreadMessages(convId, prev => prev.map(msg =>
            msg.id === aiMsgId
              ? { ...msg, activity: { kind: 'thinking' as const, label: '思考中...' }, status: 'streaming' as const }
              : msg
          ));

          result = await chatCompletion({
            model: activeModel,
            messages: chatHistory,
            webSearch,
            signal: abortController.signal,
          });
        }
      }

      if (result.type === 'tool_calls') {
        throw new Error(webSearch.mode === 'legacy_tavily'
          ? '模型连续触发工具调用超过限制，请重试。'
          : '当前模型返回了本地工具调用，但此路径不执行本地工具。');
      }

      // 流式显示最终文本回复
      let accumulated = '';
      let lastUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;
      for await (const chunk of result.stream) {
        accumulated = chunk.accumulated;
        pendingUpdatesRef.current[aiMsgId] = accumulated;
        pendingUpdateThreadsRef.current[aiMsgId] = convId;
        if (chunk.usage) {
          lastUsage = chunk.usage;
        }

        if (!rafRef.current) {
          rafRef.current = window.requestAnimationFrame(() => {
            const pendingEntries = Object.entries(pendingUpdatesRef.current);
            const conversationIds = new Set(
              pendingEntries
                .map(([messageId]) => pendingUpdateThreadsRef.current[messageId])
                .filter((id): id is UUID => Boolean(id))
            );
            for (const pendingConversationId of conversationIds) {
              updateThreadMessages(pendingConversationId, prev => prev.map(msg => {
                const pending = pendingUpdatesRef.current[msg.id];
                if (pending !== undefined) {
                  return { ...msg, content: pending, status: 'streaming' as const, activity: pending.trim() ? null : msg.activity };
                }
                return msg;
              }));
            }
            rafRef.current = null;
          });
        }
      }

      if (!accumulated.trim()) {
        throw new Error(`模型 ${activeModel.model_id} 返回了空内容，请检查 API Key 或模型可用性。`);
      }

      // 流式完成，更新最终状态
      clearPendingAssistantUpdate();
      const tokenCount = lastUsage?.total_tokens ?? result.usage?.total_tokens ?? null;
      const inputTokens = lastUsage?.prompt_tokens ?? result.usage?.prompt_tokens ?? null;
      const outputTokens = lastUsage?.completion_tokens ?? result.usage?.completion_tokens ?? null;
      const finalContent = appendCitationList(accumulated, result.citations);
      const finalMsg: Message = {
        ...aiMsg,
        content: finalContent,
        reasoning_content: result.reasoningContent,
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
        reasoning_content: result.reasoningContent,
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

      // 静默生成/更新对话标题（后台执行，失败不提示）
      (async () => {
        try {
          const openrouterModel = models.find(m => m.provider === 'openrouter');
          if (!openrouterModel?.api_key) return;

          const titleMessages = [...previousThreadMessages, userMsg, finalMsg].map(m => ({
            role: m.role,
            content: m.content,
          }));

          const newTitle = await generateConversationTitle(titleMessages, openrouterModel);
          if (newTitle && newTitle !== threadConversation.title) {
            await dbUpdateConversation(convId, { title: newTitle });
            setConversations(prev => limitConversationList(prev.map(c =>
              c.id === convId ? { ...c, title: newTitle } : c
            )));
            if (activeConversationIdRef.current === convId) {
              setActiveConversation(prev => prev ? { ...prev, title: newTitle } : prev);
            }
          }
        } catch {
          // 标题生成失败，静默忽略
        }
      })();

    } catch (e: any) {
      clearPendingAssistantUpdate();
      if (e.name === 'AbortError' || e.message?.toLowerCase()?.includes('abort')) {
        // 用户主动中断，保留当前已生成内容并标记完成
        updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'completed' as const, activity: null } : msg));
        await updateMessage(aiMsgId, { status: 'completed' });
      } else {
        console.error(e);
        showToast('AI 流式错误', e.toString(), 'error');
        updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'error' as const, activity: null } : msg));
        await updateMessage(aiMsgId, { status: 'error' });
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

      {/* 模型设置面板 */}
      {showSettings && (
        <ModelSettings
          models={models}
          visionModelId={visionModelId}
          onSelectVisionModel={(id) => {
            setVisionModelId(id);
            if (id) localStorage.setItem('quick_chat_vision_model_id', id);
            else localStorage.removeItem('quick_chat_vision_model_id');
          }}
          onSave={handleSaveModel}
          onDelete={handleDeleteModel}
          onClose={() => setShowSettings(false)}
        />
      )}

      <AppLayout
        theme={theme}
        onToggleTheme={toggleTheme}
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
        onSelectConversation={handleSelectConversation}
        onCreateConversation={handleCreateConversation}
        onDeleteConversation={handleDeleteConversation}
        onPinConversation={handlePinConversation}
        onRenameConversation={handleRenameConversation}
        onSearchConversations={setSearchQuery}
        searchQuery={searchQuery}
        onSendMessage={handleSendMessage}
        onLoadMoreMessages={handleLoadMoreMessages}
        onModelSelect={handleModelSelect}
        onUpdateSystemPrompt={handleUpdateSystemPrompt}
        activeThinkingLevel={activeThinkingLevel}
        onUpdateThinkingLevel={handleUpdateThinkingLevel}
        scrollRestoreMessageId={scrollRestoreMessageId}
        onActiveMessageIdChange={handleActiveMessageIdChange}
        onOpenSettings={() => setShowSettings(true)}
        systemPrompts={systemPrompts}
        onSaveSystemPromptPreset={handleSaveSystemPromptPreset}
        onDeleteSystemPromptPreset={handleDeleteSystemPromptPreset}
        onDeleteMessage={handleDeleteMessage}
        onStopGeneration={handleStopGeneration}
        // Agent 浏览器
        agentMode={agentMode}
        agentUrl={agentUrl}
        onOpenAgentBrowser={handleOpenAgentBrowser}
        onAgentUrlChange={handleAgentUrlChange}
        onAgentTitleChange={handleAgentTitleChange}
        onExitAgentMode={handleExitAgentMode}
      />
    </ErrorBoundary>
  );
}
