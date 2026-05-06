import React, { useState, useEffect, useRef, useMemo } from "react";
import AppLayout from "./components/layout/AppLayout";
import { GoogleGenAI } from "@google/genai";
import type {
  ConversationSummary,
  Conversation,
  Message,
  ModelConfig,
  UUID,
} from "./types/types";
import "./App.css";

// -----------------------------------------------------------------------------
// 1. 全局 Error Boundary (防止白屏)
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
// 2. 全局轻量 Toast 管理器
// -----------------------------------------------------------------------------
let toastCallback: ((title: string, desc?: string, type?: "error" | "success") => void) | null = null;
const showToast = (title: string, desc?: string, type: "error" | "success" = "error") => {
  if (toastCallback) toastCallback(title, desc, type);
};

export default function App() {
  // --- 本地状态管理 (Local Storage Backend) ---
  const [conversations, setConversations] = useState<ConversationSummary[]>(() => {
    return JSON.parse(localStorage.getItem("quick_chat_conversations") || "[]");
  });
  const [allMessages, setAllMessages] = useState<Message[]>(() => {
    return JSON.parse(localStorage.getItem("quick_chat_messages") || "[]");
  });
  const [models, setModels] = useState<ModelConfig[]>(() => {
    return JSON.parse(localStorage.getItem("quick_chat_models") || "[]");
  });

  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);
  const [activeModelId, setActiveModelId] = useState<UUID>('');

  // 当前激活会话的消息
  const messages = useMemo(() => {
    if (!activeConversation) return [];
    return allMessages.filter(m => m.conversation_id === activeConversation.id).sort((a, b) => a.created_at - b.created_at);
  }, [allMessages, activeConversation]);

  // --- 状态标志 ---
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);

  // --- 搜索状态 ---
  const [searchQuery, setSearchQuery] = useState("");
  const filteredConversations = useMemo(() => {
    if (!searchQuery) return conversations;
    const lower = searchQuery.toLowerCase();
    return conversations.filter(c => {
      // 搜索标题和最后消息预览
      if (c.title?.toLowerCase().includes(lower)) return true;
      if (c.last_message_preview?.toLowerCase().includes(lower)) return true;
      // 搜索该对话下的所有消息内容
      const convMessages = allMessages.filter(m => m.conversation_id === c.id);
      return convMessages.some(m => m.content.toLowerCase().includes(lower));
    });
  }, [conversations, allMessages, searchQuery]);

  const [toast, setToast] = useState<{ id: number, title: string, desc?: string, type: "error" | "success" } | null>(null);

  // 防抖渲染引用
  const pendingUpdatesRef = useRef<Record<UUID, string>>({});
  const rafRef = useRef<number | null>(null);

  // 注册 Toast 和同步 LocalStorage
  useEffect(() => {
    let timer: number;
    toastCallback = (title, desc, type = "error") => {
      setToast({ id: Date.now(), title, desc, type });
      clearTimeout(timer);
      timer = window.setTimeout(() => setToast(null), 4000);
    };
    return () => { toastCallback = null; clearTimeout(timer); };
  }, []);

  useEffect(() => { localStorage.setItem("quick_chat_conversations", JSON.stringify(conversations)); }, [conversations]);
  useEffect(() => { localStorage.setItem("quick_chat_messages", JSON.stringify(allMessages)); }, [allMessages]);
  useEffect(() => { localStorage.setItem("quick_chat_models", JSON.stringify(models)); }, [models]);

  // 初始化加载
  useEffect(() => {
    // 清理历史遗留的空对话
    const cleanedConversations = conversations.filter(c => c.message_count > 0);
    if (cleanedConversations.length !== conversations.length) {
      setConversations(cleanedConversations);
    }

    loadModels();

    // 恢复上次活跃对话，否则选择第一个
    const lastActiveId = localStorage.getItem("quick_chat_last_active_conv");
    const target = lastActiveId
      ? cleanedConversations.find(c => c.id === lastActiveId)
      : cleanedConversations[0];
    if (target) {
      handleSelectConversation(target.id);
    }
  }, []);

  // 模型就绪且无任何对话时，自动创建新对话
  const didAutoCreateRef = useRef(false);
  useEffect(() => {
    if (didAutoCreateRef.current) return;
    if (!activeModelId) return;
    if (activeConversation) return;
    if (conversations.length > 0) return;

    didAutoCreateRef.current = true;
    handleCreateConversation();
  }, [activeModelId, activeConversation, conversations]);

  const loadModels = async () => {
    let currentModels = models;

    // 清理已废弃的 Gemini 2.5 系列模型
    const beforeCount = currentModels.length;
    currentModels = currentModels.filter(m => !m.model_id.includes('gemini-2.5'));
    if (currentModels.length < beforeCount) {
      // 若默认模型被移除，将剩余第一个设为默认
      const hasDefault = currentModels.some(m => m.is_default);
      if (!hasDefault && currentModels.length > 0) {
        currentModels = currentModels.map((m, i) =>
          i === 0 ? { ...m, is_default: true } : { ...m, is_default: false }
        );
      }
      setModels(currentModels);
    }

    if (currentModels.length === 0) {
      // 自动从 .env 获取
      const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (envApiKey) {
        const now = Date.now();
        const defaultModels: ModelConfig[] = [
          {
            id: crypto.randomUUID(),
            provider: "google_gemini",
            model_id: "gemini-3-flash-preview",
            display_name: "Gemini 3 Flash",
            api_key: envApiKey,
            api_endpoint: null,
            temperature: 0.7,
            max_tokens: 8192,
            top_p: 0.9,
            thinking_level: 'MEDIUM',
            is_default: true,
            created_at: now,
            updated_at: now,
          },
          {
            id: crypto.randomUUID(),
            provider: "google_gemini",
            model_id: "gemini-3.1-pro-preview",
            display_name: "Gemini 3.1 Pro Preview",
            api_key: envApiKey,
            api_endpoint: null,
            temperature: 0.7,
            max_tokens: 8192,
            top_p: 0.9,
            thinking_level: 'MEDIUM',
            is_default: false,
            created_at: now,
            updated_at: now,
          },
        ];
        currentModels = defaultModels;
        setModels(currentModels);
        showToast("Success", "Loaded API Key from .env", "success");
      }
    } else {
      // 为已有模型补充缺失的 thinking_level 字段（数据迁移）
      let migrated = false;
      currentModels = currentModels.map(m => {
        if (m.thinking_level === undefined) {
          migrated = true;
          return {
            ...m,
            thinking_level: m.model_id.includes('gemini-3') ? 'MEDIUM' : null,
          } as ModelConfig;
        }
        return m;
      });
      if (migrated) {
        setModels(currentModels);
      }

      // 确保新模型也存在（已有用户可能没有新增的模型）
      const envApiKey = import.meta.env.VITE_GEMINI_API_KEY;
      if (envApiKey) {
        const existingIds = currentModels.map(m => m.model_id);
        const newModelDefs = [
          { model_id: "gemini-3.1-pro-preview", display_name: "Gemini 3.1 Pro Preview", max_tokens: 8192 },
          { model_id: "gemini-3-flash-preview", display_name: "Gemini 3 Flash Preview", max_tokens: 8192 },
        ];
        const toAdd: ModelConfig[] = [];
        for (const def of newModelDefs) {
          if (!existingIds.includes(def.model_id)) {
            toAdd.push({
              id: crypto.randomUUID(),
              provider: "google_gemini",
              model_id: def.model_id,
              display_name: def.display_name,
              api_key: envApiKey,
              api_endpoint: null,
              temperature: 0.7,
              max_tokens: def.max_tokens,
              top_p: 0.9,
              thinking_level: 'MEDIUM',
              is_default: false,
              created_at: Date.now(),
              updated_at: Date.now(),
            });
          }
        }
        if (toAdd.length > 0) {
          currentModels = [...currentModels, ...toAdd];
          setModels(currentModels);
        }
      }
    }

    if (currentModels.length > 0) {
      const defaultModel = currentModels.find(m => m.is_default) || currentModels[0];
      setActiveModelId(defaultModel.id);
    }
  };

  const handleSelectConversation = async (id: UUID) => {
    localStorage.setItem("quick_chat_last_active_conv", id);
    const summary = conversations.find(c => c.id === id);
    if (!summary) return;
    setIsLoadingMessages(true);

    // 尝试从 localStorage 恢复 system_prompt
    const stored = JSON.parse(localStorage.getItem("quick_chat_conv_details") || "{}");
    const details = stored[id] || {};

    setActiveConversation({
      id: summary.id,
      title: summary.title,
      model_id: details.model_id || activeModelId,
      system_prompt: details.system_prompt || null,
      created_at: summary.created_at,
      updated_at: summary.created_at
    });
    // 消息已经通过 useMemo 自动过滤
    setTimeout(() => setIsLoadingMessages(false), 100);
  };

  // 持久化会话详情 (system_prompt 等)
  const persistConvDetails = (id: UUID, details: { model_id?: string; system_prompt?: string | null }) => {
    const stored = JSON.parse(localStorage.getItem("quick_chat_conv_details") || "{}");
    stored[id] = { ...(stored[id] || {}), ...details };
    localStorage.setItem("quick_chat_conv_details", JSON.stringify(stored));
  };

  const handleCreateConversation = async () => {
    if (!activeModelId) {
      showToast("Cannot create", "No AI model selected");
      return;
    }

    // 如果当前对话为空，不创建新对话，保持在当前对话
    if (activeConversation && messages.length === 0) {
      return;
    }

    const newConv: Conversation = {
      id: crypto.randomUUID(),
      title: "New Chat",
      model_id: activeModelId,
      system_prompt: null,
      created_at: Date.now(),
      updated_at: Date.now()
    };
    setActiveConversation(newConv);
    // 空对话不加入 conversations 列表，发送第一条消息时才会真正保存
  };

  // ── 删除对话 ──
  const handleDeleteConversation = (id: UUID) => {
    setConversations(prev => {
      const remaining = prev.filter(c => c.id !== id);
      // 若删除的是当前激活会话，尝试切换到剩余第一个
      if (activeConversation?.id === id) {
        if (remaining.length > 0) {
          localStorage.setItem("quick_chat_last_active_conv", remaining[0].id);
          setTimeout(() => handleSelectConversation(remaining[0].id), 0);
        } else {
          localStorage.removeItem("quick_chat_last_active_conv");
          setActiveConversation(null);
        }
      }
      return remaining;
    });
    setAllMessages(prev => prev.filter(m => m.conversation_id !== id));
    // 清理详情缓存
    const stored = JSON.parse(localStorage.getItem("quick_chat_conv_details") || "{}");
    delete stored[id];
    localStorage.setItem("quick_chat_conv_details", JSON.stringify(stored));
    showToast("已删除", "对话已移除", "success");
  };

  // ── 重命名对话 ──
  const handleRenameConversation = (id: UUID, newTitle: string) => {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setConversations(prev => prev.map(c =>
      c.id === id ? { ...c, title: trimmed } : c
    ));
    if (activeConversation?.id === id) {
      setActiveConversation(prev => prev ? { ...prev, title: trimmed } : prev);
    }
  };

  // ── 更新系统提示词 ──
  const handleUpdateSystemPrompt = (prompt: string | null) => {
    if (!activeConversation) return;
    const updated = { ...activeConversation, system_prompt: prompt };
    setActiveConversation(updated);
    persistConvDetails(activeConversation.id, { system_prompt: prompt });
    showToast("已更新", "系统提示词已保存", "success");
  };

  // ── 更新模型 thinking level ──
  const handleUpdateModelThinkingLevel = (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, thinking_level: level } : m));
  };

  const handleSendMessage = async (content: string) => {
    if (!content.trim() || !activeConversation || !activeModelId) return;
    setIsSending(true);

    const now = Date.now();

    // 如果当前对话不在 conversations 列表中（空对话首次发消息），先加入列表
    const isExistingConv = conversations.some(c => c.id === activeConversation.id);
    if (!isExistingConv) {
      setConversations(prev => [{
        id: activeConversation.id,
        title: activeConversation.title,
        created_at: activeConversation.created_at,
        last_message_at: now,
        last_message_preview: content.slice(0, 120),
        message_count: 0
      }, ...prev]);
    }
    const userMsgId = crypto.randomUUID();
    const userMsg: Message = {
      id: userMsgId,
      conversation_id: activeConversation.id,
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
      conversation_id: activeConversation.id,
      role: 'assistant',
      content: '',
      status: 'streaming',
      token_count: null,
      model_id: activeModelId,
      created_at: now + 1,
      updated_at: now + 1,
    };

    // 乐观渲染 UI 并保存到全局
    setAllMessages(prev => [...prev, userMsg, aiMsg]);

    // 更新左侧列表
    setConversations(prev => prev.map(c =>
      c.id === activeConversation.id
        ? { ...c, last_message_preview: content.slice(0, 120), last_message_at: now, message_count: c.message_count + 1 }
        : c
    ).sort((a, b) => b.last_message_at - a.last_message_at));

    try {
      const activeModel = models.find(m => m.id === activeModelId);
      if (!activeModel) throw new Error("Model not found");
      if (!activeModel.api_key) throw new Error("API Key is missing");

      // 初始化 Gemini (新 SDK @google/genai)
      const ai = new GoogleGenAI({ apiKey: activeModel.api_key });

      // 构建 contents，包含历史消息和当前用户消息
      const contents = messages
        .filter(m => m.content.trim() !== '')
        .map(m => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }]
        }));
      contents.push({ role: 'user' as const, parts: [{ text: content }] });

      // 配置 thinkingConfig：Gemini 3 系列用 thinkingLevel
      const thinkingConfig = activeModel.model_id.includes('gemini-3')
        ? { thinkingLevel: activeModel.thinking_level || 'MEDIUM' as const }
        : undefined;

      const stream = await ai.models.generateContentStream({
        model: activeModel.model_id,
        contents,
        config: {
          systemInstruction: activeConversation.system_prompt || undefined,
          maxOutputTokens: activeModel.max_tokens,
          temperature: activeModel.temperature,
          topP: activeModel.top_p,
          ...(thinkingConfig && { thinkingConfig }),
        }
      });

      let accumulated = "";
      for await (const chunk of stream) {
        const text = chunk.text || "";
        accumulated += text;
        pendingUpdatesRef.current[aiMsgId] = accumulated;

        // 节流 UI 更新
        if (!rafRef.current) {
          rafRef.current = window.requestAnimationFrame(() => {
            setAllMessages(prev => prev.map(msg => {
              const pendingContent = pendingUpdatesRef.current[msg.id];
              if (pendingContent !== undefined) {
                return { ...msg, content: pendingContent, status: 'streaming' };
              }
              return msg;
            }));
            rafRef.current = null;
          });
        }
      }

      // 流式输出完成
      if (!accumulated.trim()) {
        throw new Error(`模型 ${activeModel.model_id} 返回了空内容。请检查模型是否可用或 API Key 是否有配额。`);
      }
      setAllMessages(prev => prev.map(msg =>
        msg.id === aiMsgId ? { ...msg, content: accumulated, status: 'completed' } : msg
      ));

      setConversations(prev => prev.map(c =>
        c.id === activeConversation.id
          ? { ...c, last_message_preview: accumulated.slice(0, 120), last_message_at: Date.now(), message_count: c.message_count + 2 }
          : c
      ).sort((a, b) => b.last_message_at - a.last_message_at));

    } catch (e: any) {
      console.error(e);
      showToast("AI Streaming Error", e.toString(), "error");
      setAllMessages(prev => prev.map(msg => msg.id === aiMsgId ? { ...msg, status: 'error' } : msg));
    } finally {
      setIsSending(false);
      delete pendingUpdatesRef.current[aiMsgId];
    }
  };

  const handleLoadMoreMessages = async () => {
    // 纯前端模式下暂无分页，一次性加载所有。
  };

  return (
    <ErrorBoundary>
      {/* Toast Notification Layer */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] bg-white/90 backdrop-blur-xl border border-sand-400/40 shadow-panel px-6 py-4 rounded-2xl animate-in fade-in slide-in-from-top-4 flex items-start gap-3">
          <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 shadow-[0_0_8px_currentColor] ${toast.type === 'error' ? 'text-red-500 bg-red-500' : 'text-emerald-500 bg-emerald-500'}`} />
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold text-ink-400">{toast.title}</h3>
            {toast.desc && <p className="text-xs text-ink-200 break-words max-w-sm">{toast.desc}</p>}
          </div>
        </div>
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
      />
    </ErrorBoundary>
  );
}
