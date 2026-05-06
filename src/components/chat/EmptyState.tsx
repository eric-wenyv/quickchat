import React from 'react';

interface EmptyStateProps {
  /** "no_conversation" = 未选会话; "no_messages" = 会话内无消息 */
  type: 'no_conversation' | 'no_messages';
}

/**
 * C-3: EmptyState 组件
 * 
 * 职责：
 * 1. 当未选择会话或会话内无消息时，提供高品质的占位视觉引导。
 * 2. 遵循极简主义美学，使用 sand 调色盘与细腻的阴影。
 */
export const EmptyState: React.FC<EmptyStateProps> = ({ type }) => {
  const isNoConversation = type === 'no_conversation';

  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] w-full bg-sand-100 animate-in fade-in duration-1000 ease-out">
      <div className="relative mb-12 group">
        {/* 背景氛围扩散渐变 */}
        <div className="absolute -inset-10 bg-gradient-to-tr from-sand-300/40 to-sand-400/20 rounded-full blur-3xl group-hover:scale-110 transition-transform duration-1000" />
        
        {/* 品牌标识容器：多重圆角与极简边框 */}
        <div className="relative flex items-center justify-center w-24 h-24 bg-white rounded-[2.5rem] shadow-panel border border-sand-300 group-hover:-translate-y-1.5 transition-transform duration-500 ease-out">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-12 h-12 text-ink-400"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* 极简圆形轮廓 */}
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="1.5"
              className="opacity-20"
            />
            {/* 核心几何形状：对话气泡抽象 */}
            <path
              d="M8 12C8 12 9.5 14 12 14C14.5 14 16 12 16 12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M9 9H9.01M15 9H15.01"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>

      <div className="text-center px-10 max-w-lg">
        {/* 标题：高品质排版 */}
        <h2 className="text-4xl font-bold text-ink-400 tracking-tight mb-5">
          {isNoConversation ? 'Quick-Chat' : '一切就绪'}
        </h2>
        
        {/* 描述：适度的行高与色彩对比 */}
        <p className="text-ink-200 text-lg leading-relaxed font-medium">
          {isNoConversation 
            ? '从左侧开启一段新的对话，让灵感在极简的界面中自由流动。' 
            : '当前会话尚未产生任何消息。准备好开始交流了吗？'}
        </p>
        
        {/* 装饰性视觉引导 */}
        <div className="mt-16 flex flex-col items-center gap-5">
          <div className="h-16 w-px bg-gradient-to-b from-sand-400 to-transparent" />
          <div className="flex items-center gap-4">
            <span className="text-xs font-bold uppercase tracking-[0.25em] text-ink-100 opacity-70">
              {isNoConversation ? 'Select a conversation' : 'Waiting for your command'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmptyState;
