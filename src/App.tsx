import React, { useState, useEffect, useRef, useMemo } from "react";
import AppLayout from "./components/layout/AppLayout";
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
  getModelConfigs,
  saveModelConfig,
  deleteModelConfig,
} from "./services/db";
import { chatCompletion, WEB_SEARCH_TOOL } from "./services/ai";
import type { ChatMessage } from "./services/ai";
import { searchWeb, formatSearchResults, getSearchApiKey, setSearchApiKey } from "./services/search";
import type {
  ConversationSummary,
  Conversation,
  Message,
  ModelConfig,
  UUID,
} from "./types/types";
import "./App.css";

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
        <div className="flex items-center justify-center h-screen w-screen bg-sand-100 text-ink-300">
          <div className="text-center space-y-4">
            <h1 className="text-2xl font-bold text-red-500">Something went wrong</h1>
            <p className="text-sm text-ink-200">The application encountered a fatal error. Please restart.</p>
            <button onClick={() => window.location.reload()} className="px-4 py-2 bg-sand-300 rounded-xl text-ink-400 font-medium">Reload</button>
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
  // --- 状态 ---
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [activeModelId, setActiveModelId] = useState<UUID>('');
  const [dbReady, setDbReady] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [toast, setToast] = useState<{ id: number, title: string, desc?: string, type: "error" | "success" } | null>(null);

  const pendingUpdatesRef = useRef<Record<UUID, string>>({});
  const rafRef = useRef<number | null>(null);

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
      const [convs, mods] = await Promise.all([
        getConversations(100, 0),
        getModelConfigs(),
      ]);
      setConversations(convs);
      setModels(mods);

      if (mods.length > 0) {
        const def = mods.find(m => m.is_default) || mods[0];
        setActiveModelId(def.id);
      } else {
        // 尝试从 .env 自动创建默认模型
        await seedDefaultModels();
      }

      // 恢复上次活跃会话
      const lastActiveId = localStorage.getItem("quick_chat_last_active_conv");
      if (lastActiveId) {
        const target = convs.find(c => c.id === lastActiveId);
        if (target) {
          await handleSelectConversation(target.id);
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
          });
        }
      }
      setMessages(convMessages);
    } catch (e) {
      console.error('加载消息失败:', e);
      showToast('加载消息失败', String(e));
    } finally {
      setIsLoadingMessages(false);
    }
  };

  const handleCreateConversation = async () => {
    if (!activeModelId) {
      showToast('无法创建', '请先配置 AI 模型');
      return;
    }
    if (activeConversation && messages.length === 0) return;

    const now = Date.now();
    const newConv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      model_id: activeModelId,
      system_prompt: null,
      created_at: now,
      updated_at: now,
    };
    setActiveConversation(newConv);
    setMessages([]);
  };

  const handleDeleteConversation = async (id: UUID) => {
    try {
      await dbDeleteConversation(id);
      const convs = await getConversations(100, 0);
      setConversations(convs);
      if (activeConversation?.id === id) {
        if (convs.length > 0) {
          await handleSelectConversation(convs[0].id);
        } else {
          localStorage.removeItem("quick_chat_last_active_conv");
          setActiveConversation(null);
          setMessages([]);
        }
      }
      showToast('已删除', '对话已移除', 'success');
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

  const handleUpdateModelThinkingLevel = async (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, thinking_level: level } : m));
    // thinking_level 不在数据库 schema 中，仅内存维护（或后续扩展 schema）
  };

  // --- 全局搜索 API Key 状态 ---
  const [searchApiKey, setSearchApiKeyState] = useState(() => {
    return getSearchApiKey();
  });

  const handleSetSearchApiKey = (key: string) => {
    const trimmed = key.trim();
    setSearchApiKeyState(trimmed);
    setSearchApiKey(trimmed);
  };

  // --- 将 Message[] 转换为 ChatMessage[] ---
  const buildChatHistory = (currentMessages: Message[]): ChatMessage[] => {
    const history: ChatMessage[] = [];
    if (activeConversation?.system_prompt?.trim()) {
      history.push({ role: 'system', content: activeConversation.system_prompt.trim() });
    }
    for (const msg of currentMessages) {
      if (!msg.content.trim() && msg.role !== 'assistant') continue;
      const chatMessage: ChatMessage = { role: msg.role as ChatMessage['role'], content: msg.content };
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
    setIsSending(true);

    const now = Date.now();
    const activeModel = models.find(m => m.id === activeModelId);
    if (!activeModel) {
      showToast('错误', '未找到激活的模型');
      setIsSending(false);
      return;
    }
    if (!activeModel.api_key) {
      showToast('错误', '模型未配置 API Key');
      setIsSending(false);
      return;
    }

    // 如果是新会话（未持久化），先保存
    let convId = activeConversation.id;
    const isExisting = conversations.some(c => c.id === convId);
    if (!isExisting) {
      try {
        await createConversation(activeConversation);
        setConversations(prev => [{
          id: activeConversation.id,
          title: activeConversation.title,
          created_at: activeConversation.created_at,
          last_message_at: now,
          last_message_preview: content.slice(0, 120),
          message_count: 0,
        }, ...prev]);
      } catch (e) {
        showToast('保存会话失败', String(e));
        setIsSending(false);
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
      model_id: activeModelId,
      created_at: now + 1,
      updated_at: now + 1,
    };

    // 乐观更新 UI
    setMessages(prev => [...prev, userMsg, aiMsg]);

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
          title: activeConversation.title,
          created_at: activeConversation.created_at,
          last_message_at: now,
          last_message_preview: content.slice(0, 120),
          message_count: 1,
        }, ...prev];
      return updated.sort((a, b) => b.last_message_at - a.last_message_at);
    });

    // 构建对话历史
    let chatHistory = buildChatHistory([...messages, userMsg]);
    const tools = searchApiKey ? [WEB_SEARCH_TOOL] : undefined;
    const clearPendingAssistantUpdate = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      delete pendingUpdatesRef.current[aiMsgId];
    };

    try {
      // 第一轮：可能触发 tool call
      let result = await chatCompletion({ model: activeModel, messages: chatHistory, tools });

      // 处理 Tool Calling 循环
      let toolLoopCount = 0;
      while (result.type === 'tool_calls' && toolLoopCount < 3) {
        toolLoopCount++;

        // 显示"正在搜索..."
        const toolNames = result.toolCalls.map(tc => tc.function.name).join(', ');
        setMessages(prev => prev.map(msg =>
          msg.id === aiMsgId
            ? { ...msg, content: `🔍 正在调用工具: ${toolNames}...`, status: 'streaming' as const }
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
        result = await chatCompletion({ model: activeModel, messages: chatHistory });
      }

      if (result.type === 'tool_calls') {
        throw new Error('模型连续触发工具调用超过限制，请重试。');
      }

      // 流式显示最终文本回复
      let accumulated = '';
      for await (const chunk of result.stream) {
        accumulated = chunk.accumulated;
        pendingUpdatesRef.current[aiMsgId] = accumulated;

        if (!rafRef.current) {
          rafRef.current = window.requestAnimationFrame(() => {
            setMessages(prev => prev.map(msg => {
              const pending = pendingUpdatesRef.current[msg.id];
              if (pending !== undefined) {
                return { ...msg, content: pending, status: 'streaming' as const };
              }
              return msg;
            }));
            rafRef.current = null;
          });
        }
      }

      if (!accumulated.trim()) {
        throw new Error(`模型 ${activeModel.model_id} 返回了空内容，请检查 API Key 或模型可用性。`);
      }

      // 流式完成，更新最终状态
      clearPendingAssistantUpdate();
      const finalMsg: Message = {
        ...aiMsg,
        content: accumulated,
        reasoning_content: result.reasoningContent,
        status: 'completed',
        updated_at: Date.now(),
      };
      setMessages(prev => prev.map(msg => msg.id === aiMsgId ? finalMsg : msg));
      await updateMessage(aiMsgId, {
        content: accumulated,
        reasoning_content: result.reasoningContent,
        status: 'completed',
      });

      // 更新会话列表
      setConversations(prev => prev.map(c =>
        c.id === convId
          ? { ...c, last_message_preview: accumulated.slice(0, 120), last_message_at: Date.now(), message_count: c.message_count + 1 }
          : c
      ).sort((a, b) => b.last_message_at - a.last_message_at));

    } catch (e: any) {
      console.error(e);
      showToast('AI 流式错误', e.toString(), 'error');
      clearPendingAssistantUpdate();
      setMessages(prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'error' as const } : msg));
      await updateMessage(aiMsgId, { status: 'error' });
    } finally {
      setIsSending(false);
      clearPendingAssistantUpdate();
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
      if (config.is_default) {
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

  // --- 自动创建空对话（就绪后且无任何会话时）---
  const didAutoCreateRef = useRef(false);
  useEffect(() => {
    if (didAutoCreateRef.current) return;
    if (!dbReady) return;
    if (!activeModelId) return;
    if (activeConversation) return;
    if (conversations.length > 0) return;

    didAutoCreateRef.current = true;
    handleCreateConversation();
  }, [dbReady, activeModelId, activeConversation, conversations]);

  // --- 未就绪遮罩 ---
  if (!dbReady) {
    return (
      <div className="flex items-center justify-center h-screen w-screen bg-sand-100 text-ink-300">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-sand-400 border-t-ink-400 rounded-full animate-spin mx-auto" />
          <p className="text-sm font-medium text-ink-200">正在初始化数据库...</p>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-white/90 backdrop-blur-xl border border-sand-400/40 shadow-panel px-6 py-4 rounded-2xl animate-in fade-in slide-in-from-top-4 flex items-start gap-3">
          <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_8px_currentColor] ${toast.type === 'error' ? 'text-red-500 bg-red-500' : 'text-emerald-500 bg-emerald-500'}`} />
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-ink-400">{toast.title}</h3>
            {toast.desc && <p className="text-xs text-ink-200 break-words max-w-sm">{toast.desc}</p>}
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
          searchApiKey={searchApiKey}
          onSearchApiKeyChange={handleSetSearchApiKey}
        />
      )}

      <AppLayout
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
        onRenameConversation={handleRenameConversation}
        onSearchConversations={setSearchQuery}
        searchQuery={searchQuery}
        onSendMessage={handleSendMessage}
        onLoadMoreMessages={handleLoadMoreMessages}
        onModelSelect={setActiveModelId}
        onUpdateSystemPrompt={handleUpdateSystemPrompt}
        onUpdateModelThinkingLevel={handleUpdateModelThinkingLevel}
        onOpenSettings={() => setShowSettings(true)}
      />
    </ErrorBoundary>
  );
}
