import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { MessageStatus } from '@/types/types';

interface MessageContentProps {
  content: string;
  status: MessageStatus;
}

/**
 * C-7: MessageContent
 * 消息正文渲染组件，支持 Markdown 解析与流式输出光标动画。
 */
const MessageContent: React.FC<MessageContentProps> = ({ content, status }) => {
  const isThinking = content.trim() === '' && status === 'streaming';

  return (
    <div className="w-full text-ink-300 selection:bg-sand-400/50 selection:text-ink-400">
      <article className="prose prose-sm md:prose-base max-w-none 
        prose-p:leading-relaxed prose-p:my-2
        prose-headings:text-ink-400 prose-headings:font-bold prose-headings:mt-4 prose-headings:mb-2
        prose-a:text-ink-400 prose-a:underline prose-a:underline-offset-4 hover:prose-a:text-ink-300
        prose-code:text-ink-400 prose-code:bg-sand-300/50 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-medium prose-code:before:content-none prose-code:after:content-none
        prose-pre:bg-sand-200 prose-pre:border prose-pre:border-sand-400 prose-pre:rounded-xl prose-pre:p-4 prose-pre:my-4
        prose-blockquote:border-l-sand-500 prose-blockquote:text-ink-200 prose-blockquote:pl-4 prose-blockquote:italic
        prose-ul:list-disc prose-ul:pl-5 prose-ol:list-decimal prose-ol:pl-5
        prose-li:my-1
        prose-hr:border-sand-400 prose-hr:my-6
        prose-img:rounded-xl prose-img:shadow-panel">
        {isThinking ? (
          <div className="flex items-center gap-3 py-2 select-none">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-ink-300 animate-bounce" style={{ animationDuration: '0.6s', animationDelay: '0ms' }} />
              <span className="w-2 h-2 rounded-full bg-ink-300 animate-bounce" style={{ animationDuration: '0.6s', animationDelay: '0.15s' }} />
              <span className="w-2 h-2 rounded-full bg-ink-300 animate-bounce" style={{ animationDuration: '0.6s', animationDelay: '0.3s' }} />
            </div>
            <span className="text-sm text-ink-200 font-medium">思考中...</span>
          </div>
        ) : (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        )}
        {status === 'streaming' && !isThinking && (
          <span 
            className="inline-block w-[2px] h-[1.1em] ml-1 bg-ink-400 animate-pulse rounded-full align-middle -translate-y-[1px]" 
            aria-hidden="true"
          />
        )}
      </article>
    </div>
  );
};

export default MessageContent;
