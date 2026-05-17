import React, { useState } from 'react';
import type { ModelConfig, UUID, FileAttachment } from '@/types/types';
import { ChatTextArea } from './ChatTextArea';
import SendButton from './SendButton';
import ModelSelector from './ModelSelector';
import ThinkingLevelSelector from './ThinkingLevelSelector';
import { readFileAsBase64, readFileAsText, isTextFile, serializeAttachments, formatFileSize, getFileIcon } from '@/utils/file';

interface ChatInputFooterProps {
  onSend: (content: string) => void;
  disabled: boolean;
  models: ModelConfig[];
  activeModelId: UUID;
  onModelSelect: (id: UUID) => void;
  onUpdateModelThinkingLevel: (id: UUID, level: 'LOW' | 'MEDIUM' | 'HIGH' | null) => void;
  /** 外部拖入的文件 */
  droppedFiles?: File[];
  /** 文件放下版本号（用于触发 useEffect 重新处理） */
  dropVersion?: number;
}

/**
 * ChatInputFooter (Linear-style)
 * 输入区容器：
 * - 去掉大面积深灰底色，改用和主背景同色或微微亮一点点的底色
 * - 精致边框 border: 1px solid rgba(255,255,255,0.1)
 * - 圆角收敛为 8px
 * - 发送按钮改为小圆圈设计
 */
export const ChatInputFooter: React.FC<ChatInputFooterProps> = ({
  onSend,
  disabled,
  models,
  activeModelId,
  onModelSelect,
  onUpdateModelThinkingLevel,
  droppedFiles,
  dropVersion,
}) => {
  const [content, setContent] = useState('');
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [pendingFiles, setPendingFiles] = useState<FileAttachment[]>([]);

  // 统一的文件处理逻辑（拖拽和粘贴共用）
  const processFileList = async (files: File[]) => {
    const newImages: string[] = [];
    const newAttachments: FileAttachment[] = [];
    for (const file of files) {
      try {
        const data = await readFileAsBase64(file);

        // 图片文件走 pendingImages 流程（最终转为 image_url 发给 AI）
        if (file.type.startsWith('image/')) {
          newImages.push(data);
          continue;
        }

        // 非图片文件走 pendingFiles 附件流程
        const attachment: FileAttachment = {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || 'application/octet-stream',
          size: file.size,
          data,
        };
        if (isTextFile(file.type, file.name)) {
          try {
            attachment.textContent = await readFileAsText(file);
          } catch {
            // 文本读取失败则按二进制处理
          }
        }
        newAttachments.push(attachment);
      } catch (e) {
        console.error('读取文件失败:', file.name, e);
      }
    }
    if (newImages.length > 0) {
      setPendingImages((prev) => [...prev, ...newImages]);
    }
    if (newAttachments.length > 0) {
      setPendingFiles((prev) => [...prev, ...newAttachments]);
    }
  };

  // 处理外部拖入的文件
  React.useEffect(() => {
    if (!droppedFiles || droppedFiles.length === 0) return;
    processFileList(droppedFiles);
  }, [droppedFiles, dropVersion]);

  // 处理输入框粘贴的文件（Windows 资源管理器 Ctrl+C → Ctrl+V）
  const handleFilePaste = (files: File[]) => {
    processFileList(files);
  };

  const handleSend = () => {
    const trimmed = content.trim();
    if ((!trimmed && pendingImages.length === 0 && pendingFiles.length === 0) || disabled) return;

    let finalContent = trimmed;
    if (pendingImages.length > 0) {
      const imageMarkdown = pendingImages.map((url) => `![image](${url})`).join('\n\n');
      finalContent = trimmed ? `${trimmed}\n\n${imageMarkdown}` : imageMarkdown;
    }
    if (pendingFiles.length > 0) {
      finalContent = finalContent + serializeAttachments(pendingFiles);
    }

    onSend(finalContent);
    setContent('');
    setPendingImages([]);
    setPendingFiles([]);
  };

  const handleImagePaste = (imageDataUrl: string) => {
    setPendingImages((prev) => [...prev, imageDataUrl]);
  };

  const removeImage = (index: number) => {
    setPendingImages((prev) => prev.filter((_, i) => i !== index));
  };

  const removeFile = (id: string) => {
    setPendingFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const canSend = (!!content.trim() || pendingImages.length > 0 || pendingFiles.length > 0) && !disabled;

  return (
    <footer className="w-full px-4 pt-2 pb-4 bg-linear-bg relative">
      <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-linear-border to-transparent opacity-50" />
      <div className="max-w-3xl mx-auto">
        <div
          className="relative group bg-linear-bg-elevated border border-[rgba(255,255,255,0.08)] shadow-linear-highlight rounded-2xl hover:border-linear-border-hover focus-within:border-linear-accent focus-within:shadow-linear-highlight-strong"
          style={{ transition: 'border-color 0.1s var(--ease-snappy), box-shadow 0.1s var(--ease-snappy)' }}
        >
          {/* 图片预览区 */}
          {pendingImages.length > 0 && (
            <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide">
              {pendingImages.map((url, idx) => (
                <div key={`${url.slice(-20)}-${idx}`} className="relative flex-shrink-0 group/img">
                  <img
                    src={url}
                    alt="pasted"
                    className="h-16 w-16 object-cover rounded-xl border border-linear-border"
                  />
                  <button
                    onClick={() => removeImage(idx)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-linear-text-secondary text-linear-bg rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover/img:opacity-100 transition-opacity shadow-sm"
                    title="Remove image"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 文件附件预览区 */}
          {pendingFiles.length > 0 && (
            <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto scrollbar-hide">
              {pendingFiles.map((file) => (
                <div
                  key={file.id}
                  className="relative flex-shrink-0 group/file flex items-center gap-2 px-3 py-2 rounded-xl border border-linear-border bg-linear-surface/50 hover:bg-linear-surface transition-colors"
                >
                  <FileIcon type={file.type} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-xs text-linear-text-primary font-medium truncate max-w-[120px]">
                      {file.name}
                    </span>
                    <span className="text-[10px] text-linear-text-tertiary">
                      {formatFileSize(file.size)}
                    </span>
                  </div>
                  <button
                    onClick={() => removeFile(file.id)}
                    className="ml-1 w-5 h-5 bg-linear-text-secondary text-linear-bg rounded-full flex items-center justify-center text-[10px] opacity-0 group-hover/file:opacity-100 transition-opacity shadow-sm flex-shrink-0"
                    title="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="px-2 pt-2 pb-1">
            <ChatTextArea
              value={content}
              onChange={setContent}
              onSubmit={handleSend}
              onImagePaste={handleImagePaste}
              onFilePaste={handleFilePaste}
              disabled={disabled}
              placeholder="Ask anything..."
            />
          </div>

          <div className="flex items-center justify-between px-4 py-3 border-t border-linear-border/50">
            <div className="flex items-center gap-1.5">
              <ModelSelector
                models={models}
                activeModelId={activeModelId}
                onSelect={onModelSelect}
              />
              <ThinkingLevelSelector
                models={models}
                activeModelId={activeModelId}
                onUpdateThinkingLevel={onUpdateModelThinkingLevel}
              />
              <div className="h-4 w-[1px] bg-linear-border mx-1" />
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-linear-surface text-[10px] font-medium text-linear-text-tertiary uppercase tracking-tighter">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" style={{ animation: 'status-breathe 3.5s ease-in-out infinite' }} />
                Ready
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className={`hidden sm:block transition-all duration-300 ${content.trim() || pendingImages.length > 0 ? 'opacity-40 translate-x-0' : 'opacity-0 translate-x-2'}`}>
                <span className="text-[10px] font-medium text-linear-text-tertiary uppercase tracking-widest">
                  {content.length} chars
                </span>
              </div>
              <SendButton
                onClick={handleSend}
                disabled={!canSend}
              />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

const FileIcon: React.FC<{ type: string }> = ({ type }) => {
  const icon = getFileIcon(type);
  const iconClass = "w-4 h-4 text-linear-text-tertiary";
  switch (icon) {
    case 'image':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a2.25 2.25 0 002.25-2.25V6a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 6v12a2.25 2.25 0 002.25 2.25z" />
        </svg>
      );
    case 'pdf':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'doc':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
    case 'sheet':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25-4.5h17.25m-17.25-4.5h17.25M3.375 6h17.25M1.5 6.75v10.5a2.25 2.25 0 002.25 2.25h16.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H3.75a2.25 2.25 0 00-2.25 2.25z" />
        </svg>
      );
    case 'slide':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
        </svg>
      );
    case 'archive':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
        </svg>
      );
    case 'audio':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
        </svg>
      );
    case 'video':
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.348a1.125 1.125 0 010 1.971l-11.54 6.347a1.125 1.125 0 01-1.667-.985V5.653z" />
        </svg>
      );
    default:
      return (
        <svg className={iconClass} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      );
  }
};

export default ChatInputFooter;
