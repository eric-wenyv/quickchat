import React, { useState, useRef, useEffect } from 'react';

export interface AgentTab {
  id: string;
  url: string;
  title: string;
}

interface AgentBrowserProps {
  tabs: AgentTab[];
  activeTabId: string;
  onUrlChange: (tabId: string, newUrl: string) => void;
  onTitleChange: (tabId: string, title: string) => void;
  onCloseTab: (tabId: string) => void;
  onSwitchTab: (tabId: string) => void;
  onAddTab: (url: string) => void;
  onExitAgentMode: () => void;
}

export const AgentBrowser: React.FC<AgentBrowserProps> = ({
  tabs,
  activeTabId,
  onUrlChange,
  onTitleChange,
  onCloseTab,
  onSwitchTab,
  onAddTab,
  onExitAgentMode,
}) => {
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const [inputUrl, setInputUrl] = useState(activeTab?.url || '');
  const [isLoading, setIsLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 当切换标签时，同步地址栏
  useEffect(() => {
    if (activeTab) {
      setInputUrl(activeTab.url);
    }
  }, [activeTabId, activeTab?.url]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let url = inputUrl.trim();
    if (!url) return;

    // 自动补全协议
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://' + url;
      setInputUrl(url);
    }

    if (activeTab) {
      onUrlChange(activeTab.id, url);
      setIsLoading(true);
    }
  };

  const handleRefresh = () => {
    if (iframeRef.current && activeTab) {
      setIsLoading(true);
      iframeRef.current.src = activeTab.url;
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    // 尝试获取 iframe 标题（跨域可能失败，静默处理）
    try {
      if (iframeRef.current?.contentDocument?.title) {
        onTitleChange(activeTabId, iframeRef.current.contentDocument.title);
      }
    } catch {
      // 跨域限制，忽略
    }
  };

  const handleAddNewTab = () => {
    const url = window.prompt('请输入 Agent 服务地址：', 'http://127.0.0.1:5494');
    if (url?.trim()) {
      let finalUrl = url.trim();
      if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
        finalUrl = 'http://' + finalUrl;
      }
      onAddTab(finalUrl);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-white">
      {/* 工具栏 */}
      <div className="flex items-center gap-2 px-3 py-2 bg-sand-200 border-b border-sand-400 flex-shrink-0">
        {/* 导航按钮 */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            className="p-1.5 rounded-lg text-ink-200 hover:text-ink-400 hover:bg-sand-300/50 transition-all cursor-pointer"
            title="刷新"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        </div>

        {/* 地址栏 */}
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-2">
          <div className="flex-1 relative">
            <input
              type="text"
              value={inputUrl}
              onChange={(e) => setInputUrl(e.target.value)}
              placeholder="输入地址，如 http://127.0.0.1:5494"
              className="w-full bg-sand-100 dark:bg-sand-300/50 text-ink-300 text-sm px-3 py-1.5 rounded-lg border border-sand-400/40 focus:border-sand-500 outline-none transition-all"
            />
            {isLoading && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2">
                <div className="w-3.5 h-3.5 border-2 border-sand-400 border-t-ink-400 rounded-full animate-spin" />
              </div>
            )}
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold text-white bg-ink-400 hover:bg-ink-300 rounded-lg transition-colors cursor-pointer"
          >
            访问
          </button>
        </form>

        {/* 新建标签 */}
        <button
          onClick={handleAddNewTab}
          className="p-1.5 rounded-lg text-ink-200 hover:text-ink-400 hover:bg-sand-300/50 transition-all cursor-pointer"
          title="新建标签"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>

        {/* 关闭 Agent 模式 */}
        <button
          onClick={onExitAgentMode}
          className="p-1.5 rounded-lg text-ink-200 hover:text-red-500 hover:bg-red-50 transition-all cursor-pointer"
          title="关闭 Agent 浏览器"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
        </button>
      </div>

      {/* 标签栏 */}
      <div className="flex items-center gap-0 bg-sand-200 border-b border-sand-400 overflow-x-auto flex-shrink-0 custom-scrollbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => onSwitchTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs cursor-pointer border-r border-sand-400/40 transition-all min-w-[120px] max-w-[200px] flex-shrink-0 ${
              tab.id === activeTabId
                ? 'bg-white text-ink-400 font-semibold'
                : 'bg-sand-200/60 text-ink-200 hover:bg-sand-300/50'
            }`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <span className="truncate flex-1">{tab.title || tab.url}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
              className="flex-shrink-0 p-0.5 rounded hover:bg-sand-400/50 text-ink-100 hover:text-ink-400 transition-all"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      {/* iframe 区域 */}
      <div className="flex-1 relative bg-white overflow-hidden">
        {activeTab ? (
          <iframe
            ref={iframeRef}
            key={activeTab.id + activeTab.url} // 强制重新加载当 URL 改变时
            src={activeTab.url}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={handleIframeLoad}
            title={activeTab.title || activeTab.url}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-ink-200">
            <div className="text-center space-y-3">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-sand-400">
                <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                <line x1="8" y1="21" x2="16" y2="21" />
                <line x1="12" y1="17" x2="12" y2="21" />
              </svg>
              <p className="text-sm">暂无 Agent 标签页</p>
              <button
                onClick={handleAddNewTab}
                className="px-4 py-2 text-xs font-semibold text-white bg-ink-400 hover:bg-ink-300 rounded-xl transition-colors cursor-pointer"
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
