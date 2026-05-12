import React, { useState, useRef, useEffect } from 'react';

interface AgentBrowserProps {
  url: string;
  isSidebarOpen: boolean;
  onToggleSidebar: () => void;
  onUrlChange: (newUrl: string) => void;
  onTitleChange: (title: string) => void;
  onExitAgentMode: () => void;
  onNewChat?: () => void;
}

export const AgentBrowser: React.FC<AgentBrowserProps> = ({
  url,
  isSidebarOpen,
  onToggleSidebar,
  onUrlChange,
  onTitleChange,
  onExitAgentMode,
  onNewChat,
}) => {
  const [inputUrl, setInputUrl] = useState(url || '');
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const onNewChatRef = useRef(onNewChat);
  onNewChatRef.current = onNewChat;

  // 当外部 url 变化时，同步地址栏
  useEffect(() => {
    setInputUrl(url);
  }, [url]);

  // 监听 iframe 发送的 postMessage，支持 Agent 网页请求新建对话
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // 允许来自当前加载 url 同域或可信来源的消息
      const data = e.data;
      if (
        data?.type === 'new-chat' ||
        data?.type === 'new_chat' ||
        data?.action === 'new-chat'
      ) {
        onNewChatRef.current?.();
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let finalUrl = inputUrl.trim();
    if (!finalUrl) return;

    // 自动补全协议
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = 'http://' + finalUrl;
      setInputUrl(finalUrl);
    }

    onUrlChange(finalUrl);
    setIsLoading(true);
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    // 尝试获取 iframe 标题（跨域可能失败，静默处理）
    try {
      if (iframeRef.current?.contentDocument?.title) {
        const title = iframeRef.current.contentDocument.title;
        onTitleChange(title);
      }
    } catch {
      // 跨域限制，忽略
    }
  };

  const handleChangeUrl = () => {
    const newUrl = window.prompt('请输入 Agent 服务地址：', url || 'http://127.0.0.1:5494');
    if (newUrl?.trim()) {
      let finalUrl = newUrl.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl;
      }
      onUrlChange(finalUrl);
      setInputUrl(finalUrl);
      setIsLoading(true);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-linear-bg">
      {/* 工具栏 — 悬浮样式，与顶部留出间隙 */}
      <div className="flex items-center gap-2 mx-3 mt-3 mb-2 px-3 py-2 bg-linear-bg-elevated rounded-lg border border-linear-border flex-shrink-0">
        {/* 展开侧边栏按钮（替代原刷新按钮位置） */}
        {!isSidebarOpen && (
          <button
            onClick={onToggleSidebar}
            className="p-1.5 rounded-lg text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface transition-all cursor-pointer"
            title="展开侧边栏"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* 地址栏 */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="输入地址，如 http://127.0.0.1:5494"
              className="w-full bg-linear-bg text-linear-text-secondary text-sm px-3 py-1.5 rounded-lg border border-linear-border focus:border-linear-border-hover outline-none transition-all"
            />
            {isLoading && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <div className="w-3.5 h-3.5 border-2 border-linear-border border-t-linear-text-secondary rounded-full animate-spin" />
              </div>
            )}
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold text-white bg-linear-accent hover:bg-linear-accent-hover rounded-lg transition-colors cursor-pointer"
          >
            访问
          </button>
        </form>

        {/* 切换地址 */}
        <button
          onClick={handleChangeUrl}
          className="p-1.5 rounded-lg text-linear-text-tertiary hover:text-linear-text-secondary hover:bg-linear-surface transition-all cursor-pointer"
          title="切换地址"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>

        {/* 关闭 Agent 模式 */}
        <button
          onClick={onExitAgentMode}
          className="p-1.5 rounded-lg text-linear-text-tertiary hover:text-red-400 hover:bg-red-500/10 transition-all cursor-pointer"
          title="关闭 Agent 浏览器"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* iframe 区域 */}
      <div className="flex-1 relative bg-linear-bg overflow-hidden mx-3 mb-3 rounded-lg border border-linear-border">
        {url ? (
          <iframe
            ref={iframeRef}
            key={url} // 强制重新加载当 URL 改变时
            src={url}
            className="w-full h-full border-0 rounded-xl"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={handleIframeLoad}
            title={url}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-linear-text-tertiary">
            <div className="text-center space-y-3">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-linear-border">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <p className="text-sm">暂无 Agent 地址</p>
              <button
                onClick={handleChangeUrl}
                className="px-4 py-2 text-xs font-semibold text-white bg-linear-accent hover:bg-linear-accent-hover rounded-lg transition-colors cursor-pointer"
              >
                添加 Agent 地址
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgentBrowser;
