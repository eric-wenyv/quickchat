// =============================================================================
// Quick-Chat — 消息文本选择工具（移动端长按选区）
// =============================================================================
// 为消息长按选择提供底层能力：
// 1. 在块级元素内定位首/尾文本节点（跳过 svg/代码隐藏层等不可见内容）。
// 2. 从长按目标向上解析"当前段落"（最内层块级元素）。
// 3. 以 setBaseAndExtent 优先建立选区（锚点在开头，拖拽手柄方向自然），
//    降级为 Range.selectNodeContents + addRange。

/** 最内层优先的块级选择器：长按目标向上爬取时命中第一个即停 */
const BLOCK_SELECTOR =
  'p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, dt, dd, figcaption, ul, ol, table';

/** 命中即视为"不可段落选择"的元素（按钮/链接/图标/图表/代码块头部等 chrome） */
const UNSELECTABLE_SELECTOR = 'button, a, [role="button"], svg, .qc-mermaid, [data-no-block-select]';

export interface TextPosition {
  node: Text;
  offset: number;
}

const isSkippableTextNode = (node: Text): boolean => {
  if (!node.nodeValue || !node.nodeValue.trim()) return true;
  let el: Element | null = node.parentElement;
  while (el) {
    if (/^(svg|script|style|textarea|select)$/i.test(el.tagName)) return true;
    el = el.parentElement;
  }
  return false;
};

const boundaryTextPosition = (root: HTMLElement, last: boolean): TextPosition | null => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Text | null = null;
  let result: Text | null = null;
  while ((node = walker.nextNode() as Text | null)) {
    if (isSkippableTextNode(node)) continue;
    result = node;
    if (!last) break; // 首节点：第一个合格即停；尾节点：持续走到最后
  }
  return result ? { node: result, offset: result.nodeValue?.length ?? 0 } : null;
};

export const firstTextNode = (root: HTMLElement): TextPosition | null => boundaryTextPosition(root, false);

export const lastTextNode = (root: HTMLElement): TextPosition | null => boundaryTextPosition(root, true);

/**
 * 从长按目标向上解析可选中的块级元素（root 为界）。
 * 返回 null 表示该位置不可段落选择（chrome / 图表 / 无文本）。
 */
export const findSelectableBlock = (
  target: EventTarget | null,
  root: HTMLElement,
): HTMLElement | null => {
  if (!(target instanceof Element) || !root.contains(target)) return null;
  if (target.closest(UNSELECTABLE_SELECTOR)) return null;

  const block = target.closest<HTMLElement>(BLOCK_SELECTOR);
  if (!block || !root.contains(block)) return null;
  if (!firstTextNode(block)) return null;
  return block;
};

/**
 * 全选元素内容并建立选区。返回是否成功（无可选文本时为 false）。
 */
export const selectElementContents = (el: HTMLElement): boolean => {
  const sel = window.getSelection();
  if (!sel) return false;
  const first = firstTextNode(el);
  const last = lastTextNode(el);
  sel.removeAllRanges();
  if (first && last) {
    if (typeof sel.setBaseAndExtent === 'function') {
      sel.setBaseAndExtent(first.node, 0, last.node, last.offset);
      return true;
    }
    const range = document.createRange();
    range.setStart(first.node, 0);
    range.setEnd(last.node, last.offset);
    sel.addRange(range);
    return true;
  }
  // 无合格文本节点：整体选区兜底（空元素时 rangeCount 仍为 0）
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.addRange(range);
  return sel.rangeCount > 0;
};

/**
 * 返回"锚点落在 root 内且非塌陷"的当前选区 Range，否则 null。
 */
export const getSelectionRangeInside = (root: HTMLElement): Range | null => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const startEl =
    range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
  return startEl && root.contains(startEl) ? range : null;
};

/**
 * 若当前选区落在 root 内则清除（收起悬浮条时避免原生手柄残留）。
 */
export const clearSelectionIfInside = (root: HTMLElement | null): void => {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel) return;
  const anchor =
    sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement ?? null;
  if (anchor && root.contains(anchor)) sel.removeAllRanges();
};
