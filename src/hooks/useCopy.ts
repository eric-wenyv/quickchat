import { useCallback, useState } from 'react';

/**
 * 写入系统剪贴板；clipboard API 不可用时退回隐藏 textarea + execCommand。
 */
export const copyTextToClipboard = async (text: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
};

/**
 * 复制反馈 hook：copy() 写入剪贴板并将 copied 置 true，2s 后自动复位。
 */
const useCopy = (text: string) => {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    await copyTextToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return { copied, copy };
};

export default useCopy;
