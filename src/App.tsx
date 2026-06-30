import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import AppLayout from "./components/layout/AppLayout";
import { useTheme } from "./hooks/useTheme";
import ModelSettings from "./components/settings/ModelSettings";
import {
  initDatabase,
  migrateFromLocalStorage,
  getConversations,
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
  getSystemPrompts,
  saveSystemPrompt,
  deleteSystemPrompt,
} from "./services/db";
import { chatCompletion, WEB_SEARCH_TOOL, generateConversationTitle } from "./services/ai";
import type { ChatMessage, ChatContentPart } from "./services/ai";
import { parseAttachments, getLanguageFromFilename } from "./utils/file";
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
  'Proactively create an artifact when the user asks to explain, analyze, compare, teach, or reason about an algorithm, protocol, data structure, operating-system mechanism, network flow, state machine, math process, scheduling policy, or other step-by-step system behavior, even if the user did not explicitly ask for HTML or an app.',
  'For these explanation-heavy topics, prefer a concise textual explanation plus one complete single-file HTML document in a fenced code block with language html. Skip the artifact only when the user explicitly asks for text only, code only, or no visualization.',
  'Keep all HTML, CSS, and JavaScript inline. Do not rely on external CDNs, remote scripts, network requests, backend services, local storage, or cookies.',
  'Make the artifact useful immediately: include sample data, visible state, labels, step controls, reset controls, comparisons, and short status text when they help users inspect the concept.',
  'The artifact is rendered in a borderless host area on a #181818 chat background. Design it as part of the app surface, not as a framed embedded webpage.',
  'Use Quick Chat layout primitives when building artifacts: <main class="qc-artifact">, .qc-artifact-header, .qc-artifact-layout, .qc-artifact-canvas, .qc-artifact-side, .qc-artifact-controls, .qc-artifact-stats, .qc-artifact-panel, .qc-artifact-log, and .qc-artifact-badge. These classes are pre-styled by the host.',
  'For algorithm visualizers, use this default shape: header at top, a two-column .qc-artifact-layout with the main diagram in .qc-artifact-canvas and controls, stats, details, or legends in .qc-artifact-side, then a compact .qc-artifact-log. On narrow widths it will stack automatically.',
  'If no side rail is needed, use .qc-artifact-layout.qc-single or data-layout="single" and keep the canvas centered. The main diagram must use the available width and be centered horizontally; never pin the visualization to the left while leaving the right side empty.',
  'Keep controls and logs near the visualization, not far below it. Logs should be compact, scroll internally, and avoid forcing the whole artifact tall.',
  'Use a Claude-like integrated layout: transparent top-level shell, no outer card, panel, border, shadow, or rounded frame around the whole artifact, no browser chrome, no large page header, no full-screen landing hero, and no body/page scrolling.',
  'Internal buttons, inputs, table lines, diagram nodes, and small grouped controls may use subtle borders, but avoid enclosing the entire visualization or every region in heavy cards.',
  'Avoid fixed 100vh layouts, fixed-width desktop-only designs, sticky/fixed overlays, decorative gradients, and excessive padding. Do not override the qc-artifact layout classes with fixed page positioning. The host will resize the frame to content height.',
  'Use the user\'s language for all surrounding explanation and visible artifact text. Only create an artifact when it adds value; otherwise answer normally.',
].join('\n');

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
  const [activeModelId, setActiveModelId] = useState<UUID>('');
  const [dbReady, setDbReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [systemPrompts, setSystemPrompts] = useState<SystemPrompt[]>([]);

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
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

  // --- Agent 浏览器操作 ---
  const handleOpenAgentBrowser = () => {
    const url = window.prompt('请输入 Agent 服务地址：', 'http://127.0.0.1:5494');
    if (url?.trim()) {
      let finalUrl = url.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl;
      }

      // 创建带 agent_url 的新会话并选中
      const now = Date.now();
      const newConv: Conversation = {
        id: crypto.randomUUID(),
        title: finalUrl,
        model_id: activeModelId,
        system_prompt: null,
        created_at: now,
        updated_at: now,
        agent_url: finalUrl,
      };

      createConversation(newConv)
        .then(() => {
          setConversations(prev => sortConversations([{
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
        setConversations(prev => prev.map(c =>
          c.id === activeConversation.id ? { ...c, agent_url: newUrl } : c
        ));
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
        getConversations(100, 0),
        getModelConfigs(),
        getSystemPrompts(),
      ]);
      setConversations(convs);
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
      const lastActiveId = localStorage.getItem("quick_chat_last_active_conv");
      if (lastActiveId) {
        const target = convs.find(c => c.id === lastActiveId);
        if (target) {
          await handleSelectConversation(target.id);
        } else if (convs.length > 0) {
          await handleSelectConversation(convs[0].id);
        }
      } else if (convs.length > 0) {
        await handleSelectConversation(convs[0].id);
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

  // --- 搜索过滤 ---
  const filteredConversations = useMemo(() => {
    if (!searchQuery) return conversations;
    const lower = searchQuery.toLowerCase();
    return conversations.filter(c => {
      if (c.title?.toLowerCase().includes(lower)) return true;
      if (c.last_message_preview?.toLowerCase().includes(lower)) return true;
      return false;
    });
  }, [conversations, searchQuery]);

  // --- 会话操作 ---
  const handleSelectConversation = async (id: UUID) => {
    localStorage.setItem("quick_chat_last_active_conv", id);

    setIsLoadingMessages(true);
    try {
      const [convDetail, convMessages] = await Promise.all([
        getConversation(id),
        getMessages(id, 200),
      ]);

      if (convDetail) {
        setActiveConversation(convDetail);
        // 若会话绑定了 Agent 地址，自动进入 Agent 模式
        if (convDetail.agent_url) {
          setAgentUrl(convDetail.agent_url);
          setAgentMode(true);
        } else {
          setAgentMode(false);
        }
      } else {
        // 会话可能不存在，从列表找摘要信息
        const convs = await getConversations(100, 0);
        setConversations(convs);
        const s = convs.find(c => c.id === id);
        if (s) {
          setActiveConversation({
            id,
            title: s.title,
            model_id: activeModelId,
            system_prompt: null,
            created_at: s.created_at,
            updated_at: s.last_message_at,
            agent_url: s.agent_url ?? null,
          });
          if (s.agent_url) {
            setAgentUrl(s.agent_url);
            setAgentMode(true);
          } else {
            setAgentMode(false);
          }
        }
      }
      const cachedMessages = messagesByConversationRef.current[id];
      setMessages(cachedMessages ?? convMessages);
      messagesByConversationRef.current[id] = cachedMessages ?? convMessages;
    } catch (e) {
      console.error('加载消息失败:', e);
      showToast('加载消息失败', String(e));
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleCreateConversation = useCallback(async () => {
    let modelId = activeModelId;
    // 如果 activeModelId 为空但已有模型配置，自动 fallback 到第一个可用模型
    if (!modelId && models.length > 0) {
      const fallback = models.find(m => m.is_default) || models[0];
      modelId = fallback.id;
      setActiveModelId(modelId);
    }
    if (!modelId) {
      showToast('无法创建', '请先配置 AI 模型');
      return;
    }
    // 在 Agent 模式下允许创建新对话（退出 Agent 模式），避免空对话拦截导致按钮无响应
    if (activeConversation && messages.length === 0 && !agentMode) return;

    const now = Date.now();
    const newConv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      model_id: modelId,
      system_prompt: null,
      created_at: now,
      updated_at: now,
      agent_url: null,
    };
    setActiveConversation(newConv);
    setMessages([]);
    setAgentMode(false);
  }, [activeModelId, models, activeConversation, messages, agentMode]);

  const handleDeleteConversation = async (id: UUID) => {
    try {
      await dbDeleteConversation(id);
      abortControllersRef.current[id]?.abort();
      delete abortControllersRef.current[id];
      delete messagesByConversationRef.current[id];
      const convs = await getConversations(100, 0);
      setConversations(convs);
      if (activeConversation?.id === id) {
        if (convs.length > 0) {
          await handleSelectConversation(convs[0].id);
        } else {
          localStorage.removeItem("quick_chat_last_active_conv");
          setActiveConversation(null);
          setMessages([]);
          setAgentMode(false);
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
      const convs = await getConversations(100, 0);
      setConversations(convs);
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
      const convs = await getConversations(100, 0);
      setConversations(convs);
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
      const convs = await getConversations(100, 0);
      setConversations(convs);
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

  const handleUpdateModelThinkingLevel = async (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, thinking_level: level } : m));
    // thinking_level 不在数据库 schema 中，仅内存维护（或后续扩展 schema）
  };

  // --- 将 Message[] 转换为 ChatMessage[] ---
  const IMAGE_MARKDOWN_REGEX = /!\[[^\]]*\]\((data:image\/[^;)]+;base64,[A-Za-z0-9+/=]+)\)/g;

  const buildChatHistory = (conversation: Conversation, currentMessages: Message[]): ChatMessage[] => {
    const history: ChatMessage[] = [];
    history.push({ role: 'system', content: BUILT_IN_ARTIFACT_PROMPT });
    if (conversation.system_prompt?.trim()) {
      history.push({ role: 'system', content: conversation.system_prompt.trim() });
    }
    for (const msg of currentMessages) {
      // 剥离文件附件，分离正文与附件元数据
      const { text: textWithoutAttachments, attachments } = parseAttachments(msg.content);
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

          const parts: ChatContentPart[] = [];
          if (textOnly) {
            parts.push({ type: 'text', text: textOnly });
          }
          for (const url of imageUrls) {
            parts.push({ type: 'image_url', image_url: { url } });
          }
          content = parts;
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
        setConversations(prev => sortConversations([{
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
      return sortConversations(updated);
    });

    // 构建对话历史
    let chatHistory = buildChatHistory(threadConversation, [...previousThreadMessages, userMsg]);
    const tools = [WEB_SEARCH_TOOL];
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
      // 第一轮：可能触发 tool call
      let result = await chatCompletion({ model: activeModel, messages: chatHistory, tools, signal: abortController.signal });

      // 处理 Tool Calling 循环
      let toolLoopCount = 0;
      while (result.type === 'tool_calls' && toolLoopCount < 3) {
        toolLoopCount++;

        // 显示"正在搜索..."
        const toolNames = result.toolCalls.map(tc => tc.function.name).join(', ');
        updateThreadMessages(convId, prev => prev.map(msg =>
          msg.id === aiMsgId
            ? { ...msg, content: `正在调用工具: ${toolNames}...`, status: 'streaming' as const }
            : msg
        ));

        // 将 assistant 的 tool call 追加到历史
        chatHistory.push({
          role: 'assistant',
          content: result.assistantMessage || '',
          tool_calls: result.toolCalls,
          reasoning_content: result.reasoningContent,
        });

        // 执行每个 tool call
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

        // 再次请求（不带 tools，避免无限循环）
        result = await chatCompletion({ model: activeModel, messages: chatHistory, signal: abortController.signal });
      }

      if (result.type === 'tool_calls') {
        throw new Error('模型连续触发工具调用超过限制，请重试。');
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
                  return { ...msg, content: pending, status: 'streaming' as const };
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
      const finalMsg: Message = {
        ...aiMsg,
        content: accumulated,
        reasoning_content: result.reasoningContent,
        status: 'completed',
        token_count: tokenCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        updated_at: Date.now(),
      };
      updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? finalMsg : msg));
      await updateMessage(aiMsgId, {
        content: accumulated,
        reasoning_content: result.reasoningContent,
        status: 'completed',
        token_count: tokenCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
      });

      // 更新会话列表
      setConversations(prev => sortConversations(prev.map(c =>
        c.id === convId
          ? { ...c, last_message_preview: accumulated.slice(0, 120), last_message_at: Date.now(), message_count: c.message_count + 1 }
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
            setConversations(prev => prev.map(c =>
              c.id === convId ? { ...c, title: newTitle } : c
            ));
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
        updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'completed' as const } : msg));
        await updateMessage(aiMsgId, { status: 'completed' });
      } else {
        console.error(e);
        showToast('AI 流式错误', e.toString(), 'error');
        updateThreadMessages(convId, prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'error' as const } : msg));
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
    // 分页暂未实现，一次性加载
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
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-linear-bg-elevated/95 backdrop-blur-xl border border-linear-border shadow-2xl px-6 py-4 rounded-xl animate-in fade-in slide-in-from-top-4 flex items-start gap-3">
          <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_8px_currentColor] ${toast.type === 'error' ? 'text-red-400 bg-red-400' : 'text-emerald-400 bg-emerald-400'}`} />
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-linear-text-primary">{toast.title}</h3>
            {toast.desc && <p className="text-xs text-linear-text-tertiary break-words max-w-sm">{toast.desc}</p>}
          </div>
        </div>
      )}

      {/* 模型设置面板 */}
      {showSettings && (
        <ModelSettings
          models={models}
          onSave={handleSaveModel}
          onDelete={handleDeleteModel}
          onClose={() => setShowSettings(false)}
        />
      )}

      <AppLayout
        theme={theme}
        onToggleTheme={toggleTheme}
        conversations={filteredConversations}
        activeConversation={activeConversation}
        messages={messages}
        models={models}
        activeModelId={activeModelId}
        isLoadingConversations={isLoadingConversations}
        isLoadingMessages={isLoadingMessages}
        isSending={isSending}
        hasMoreMessages={false}
        onSelectConversation={handleSelectConversation}
        onCreateConversation={handleCreateConversation}
        onDeleteConversation={handleDeleteConversation}
        onPinConversation={handlePinConversation}
        onRenameConversation={handleRenameConversation}
        onSearchConversations={setSearchQuery}
        searchQuery={searchQuery}
        onSendMessage={handleSendMessage}
        onLoadMoreMessages={handleLoadMoreMessages}
        onModelSelect={setActiveModelId}
        onUpdateSystemPrompt={handleUpdateSystemPrompt}
        onUpdateModelThinkingLevel={handleUpdateModelThinkingLevel}
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
