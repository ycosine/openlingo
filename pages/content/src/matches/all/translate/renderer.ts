import {
  APPEND_INSIDE_TAGS,
  BLOCK_CLASS,
  INLINE_CLASS,
  LOADING_CLASS,
  SOURCE_ATTR,
  SOURCE_ID_ATTR,
  STYLE_ELEMENT_ID,
  TARGET_ATTR,
  TARGET_CLASS,
} from './constants.js';
import { stripDiscardPlaceholders } from './scanner.js';
import type { PendingUnit } from './types.js';
import type { PageTranslationFontType } from '@extension/storage';

const DEFAULT_PAGE_TRANSLATION_FONT: PageTranslationFontType = 'lxgw-wenkai-lite';

const PAGE_FONT_FAMILIES: Record<PageTranslationFontType, string> = {
  'lxgw-wenkai-lite': '"OpenLingo LXGW WenKai Lite", "Kaiti SC", KaiTi, serif',
  page: 'inherit',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans CJK SC", sans-serif',
  serif: 'Georgia, "Times New Roman", "Songti SC", SimSun, serif',
};

const fontAssetUrl = (): string => chrome.runtime.getURL('options/fonts/LXGWWenKaiLite-Regular.ttf');

const styleText = (pageFont: PageTranslationFontType): string => `
@font-face {
  font-family: "OpenLingo LXGW WenKai Lite";
  src: url("${fontAssetUrl()}") format("truetype");
  font-style: normal;
  font-weight: 400;
  font-display: swap;
}
.${TARGET_CLASS} {
  font-style: normal;
  font-family: ${PAGE_FONT_FAMILIES[pageFont]};
  color: #15201F;
  opacity: .9;
}
.${BLOCK_CLASS} {
  display: block;
  margin-top: .15em;
}
.${INLINE_CLASS} {
  margin-left: .35em;
}
.${LOADING_CLASS} {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  opacity: .6;
}
.${LOADING_CLASS}.${BLOCK_CLASS} {
  display: flex;
}
.${LOADING_CLASS} > i {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #0F4F4A;
  animation: ol-dot 1.1s infinite ease-in-out;
  display: inline-block;
}
.${LOADING_CLASS} > i:nth-child(2) { animation-delay: .15s; }
.${LOADING_CLASS} > i:nth-child(3) { animation-delay: .3s; }
@keyframes ol-dot {
  0%, 80%, 100% { transform: translateY(0); opacity: .35; }
  40% { transform: translateY(-2px); opacity: 1; }
}
`;

const ensureStyle = (pageFont: PageTranslationFontType = DEFAULT_PAGE_TRANSLATION_FONT): void => {
  if (document.getElementById(STYLE_ELEMENT_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = styleText(pageFont);
  document.head.appendChild(style);
};

const updateTranslationFont = (pageFont: PageTranslationFontType): void => {
  const style = document.getElementById(STYLE_ELEMENT_ID);
  if (style) style.textContent = styleText(pageFont);
};

const isBlockLikeDisplay = (el: HTMLElement): boolean => {
  try {
    const d = window.getComputedStyle(el).display;
    return d === 'block' || d === 'list-item' || d === 'flex' || d === 'grid' || d.startsWith('table');
  } catch {
    return true;
  }
};

/**
 * Place the target node relative to the source.
 * Inline-into-button/link path is intentionally gone — units are paragraph blocks only;
 * APPEND_INSIDE_TAGS still get inner block children for list/table cells.
 */
const placeTargetNode = (sourceEl: HTMLElement, target: HTMLElement): void => {
  if (isBlockLikeDisplay(sourceEl) && !APPEND_INSIDE_TAGS.has(sourceEl.tagName)) {
    target.classList.add(BLOCK_CLASS);
    sourceEl.insertAdjacentElement('afterend', target);
    return;
  }
  if (APPEND_INSIDE_TAGS.has(sourceEl.tagName)) {
    target.classList.add(BLOCK_CLASS);
    sourceEl.appendChild(target);
    return;
  }
  // Rare non-block unit (e.g. flex item styled oddly): sibling block is safer than nesting.
  target.classList.add(BLOCK_CLASS);
  sourceEl.insertAdjacentElement('afterend', target);
};

const createPlaceholder = (sourceEl: HTMLElement): HTMLElement => {
  const node = document.createElement('span');
  node.setAttribute(TARGET_ATTR, '1');
  node.classList.add(TARGET_CLASS, LOADING_CLASS);
  node.innerHTML = '<i></i><i></i><i></i>';
  placeTargetNode(sourceEl, node);
  return node;
};

const swapPlaceholderToTranslation = (unit: PendingUnit, translatedHtml: string): void => {
  if (!unit.placeholder) return;
  unit.placeholder.classList.remove(LOADING_CLASS);
  unit.placeholder.innerHTML = stripDiscardPlaceholders(translatedHtml);
  unit.status = 'done';
};

const removePlaceholder = (unit: PendingUnit): void => {
  if (unit.placeholder) {
    unit.placeholder.remove();
    unit.placeholder = null;
  }
};

/**
 * Remove every translation node attached to a source: inner children
 * (append-inside placement) and the following-sibling chain (block placement).
 * Used when a source's content changed and its translation is stale.
 */
const removeAttachedTargets = (sourceEl: HTMLElement): void => {
  sourceEl.querySelectorAll(`[${TARGET_ATTR}="1"]`).forEach(n => n.remove());
  let next = sourceEl.nextElementSibling;
  while (next && next.hasAttribute(TARGET_ATTR)) {
    const cur = next;
    next = next.nextElementSibling;
    cur.remove();
  }
};

const clearAllMarks = (): void => {
  document.querySelectorAll(`[${TARGET_ATTR}="1"]`).forEach(n => n.remove());
  document.querySelectorAll(`[${SOURCE_ATTR}="1"]`).forEach(n => {
    n.removeAttribute(SOURCE_ATTR);
    n.removeAttribute(SOURCE_ID_ATTR);
  });
};

export {
  clearAllMarks,
  createPlaceholder,
  ensureStyle,
  placeTargetNode,
  removeAttachedTargets,
  removePlaceholder,
  swapPlaceholderToTranslation,
  updateTranslationFont,
};
