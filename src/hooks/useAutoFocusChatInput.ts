import { useEffect } from 'react';

/**
 * 全局键盘捕获：当用户按下任意可打印字符（且未按住 Ctrl/Meta/Alt 等修饰键），
 * 并且当前焦点不在任何文本输入元素（搜索框、其他 textarea、设置面板里的 input 等）上时，
 * 自动聚焦到聊天输入框，从而让该字符直接进入消息输入域。
 *
 * 约束：
 * - 不会夺走已聚焦文本输入（input/textarea/select/contenteditable）的焦点。
 *   这覆盖了搜索栏、模型设置弹窗内的各类输入控件等。
 * - 当打开模态/对话框（role="dialog" 且 aria-modal="true"）时不抢占焦点。
 * - 当存在文本选区时（避免破坏用户的复制/选择意图）不抢占焦点。
 * - 仅在按下「单个字符」键且无 Ctrl/Meta/Alt 修饰时触发，避免与快捷键冲突。
 * - 当聊天输入框处于 disabled 状态（发送中 / 消息加载中）时不抢占焦点。
 * - 跳过 IME 输入合成期间的按键（避免打断中文/日文输入法）。
 *
 * 锚点：聊天输入框标记为 `textarea[data-chat-input="true"]`（见 ChatTextArea.tsx）。
 */
const CHAT_INPUT_SELECTOR = 'textarea[data-chat-input="true"]';
const TEXT_ENTRY_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return TEXT_ENTRY_TAGS.has(target.tagName);
}

function hasActiveModalOverlay(doc: Document): boolean {
  // 任何带 role="dialog" aria-modal="true" 的打开状态遮罩（如 ModelSettings）
  return Boolean(
    doc.querySelector('[role="dialog"][aria-modal="true"]:not([hidden]):not([aria-hidden="true"])')
  );
}

export function useAutoFocusChatInput(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 跳过 IME 输入合成期间的键
      if (e.isComposing || e.keyCode === 229) return;
      // 跳过修饰键组合（快捷键、复制粘贴等）
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      // 仅响应单字符按键
      if (e.key.length !== 1) return;

      // 已聚焦在任何文本输入元素（含聊天输入框本身）上时，不抢占焦点
      const active = document.activeElement;
      if (active && isTextEntryTarget(active)) return;

      // 模态/对话框打开时不抢占焦点
      if (hasActiveModalOverlay(document)) return;

      // 存在选中的文本时（用户可能要复制/选区操作），不抢占焦点
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString().trim().length > 0) return;

      const chatInput = document.querySelector<HTMLTextAreaElement>(CHAT_INPUT_SELECTOR);
      if (!chatInput) return;
      if (chatInput.disabled) return;
      if (document.activeElement === chatInput) return;

      // 捕获阶段聚焦：在此 key 事件结束之前，浏览器将把该字符投递到新聚焦的 textarea，
      // 因此用户无需额外按键即可看到字符被输入到聊天框中。
      chatInput.focus();
    };

    // 捕获阶段优先，确保在任何输入处理逻辑之前介入
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);
}
