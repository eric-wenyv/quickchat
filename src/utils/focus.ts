const FOCUS_PRESERVE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [data-focus-preserve="true"]';

const FOCUS_PRESERVE_ANCESTOR_SELECTOR =
  '[role="dialog"], [data-focus-preserve="true"]';

export function shouldPreserveCurrentFocus(
  activeElement: Element | null,
  targetElement?: Element | null
): boolean {
  if (!activeElement || activeElement === targetElement) {
    return false;
  }

  return (
    activeElement.matches(FOCUS_PRESERVE_SELECTOR) ||
    activeElement.closest(FOCUS_PRESERVE_ANCESTOR_SELECTOR) !== null
  );
}
