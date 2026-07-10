import {
  BLOCK_TAGS,
  EXCLUDE_ROLES,
  HARD_EXCLUDE_TAGS,
  INLINE_WHITELIST_TAGS,
  LINK_DENSITY_MAX_CHARS,
  LINK_DENSITY_THRESHOLD,
  MIN_MEANINGFUL_LEN,
  SERIALIZE_KEEP_TAGS,
  SKIP_TAGS,
  SOURCE_ATTR,
  SOURCE_ID_ATTR,
  TARGET_ATTR,
  TARGET_CLASS,
  TARGET_LANG_RATIO,
} from './constants.js';
import type { PendingUnit, ScanOptions } from './types.js';

interface ScanResult {
  units: PendingUnit[];
  nextUnitIndex: number;
}

// ─── Visibility / text heuristics ───────────────────────────────────────────

const isHiddenStyle = (el: Element): boolean => {
  if ((el as HTMLElement).hidden) return true;
  if (el.getAttribute('aria-hidden') === 'true') return true;
  // Prefer cheap attribute checks; computed style only when connected.
  if (!el.isConnected) return false;
  // checkVisibility is native and cheaper than materializing a computed style
  // declaration; it also accounts for hidden ancestors.
  const check = (el as HTMLElement & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
  if (typeof check === 'function') {
    try {
      return !check.call(el, { visibilityProperty: true, checkVisibilityCSS: true });
    } catch {
      // fall through to computed style
    }
  }
  try {
    const cs = window.getComputedStyle(el as HTMLElement);
    if (cs.display === 'none' || cs.visibility === 'hidden') return true;
  } catch {
    // jsdom / detached edge cases
  }
  return false;
};

const isMeaningfulText = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < MIN_MEANINGFUL_LEN) return false;
  if (/^[\d\s\p{P}\p{S}]+$/u.test(trimmed)) return false;
  return true;
};

/** Character-class maps for same-language skip (target already mostly that script). */
const SCRIPT_PATTERNS: Array<{ langs: string[]; re: RegExp }> = [
  { langs: ['ZH', 'ZH-CN', 'ZH-TW', 'ZH-HANS', 'ZH-HANT'], re: /[\u3400-\u9fff\uf900-\ufaff]/gu },
  { langs: ['JA'], re: /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/gu },
  { langs: ['KO'], re: /[\uac00-\ud7af\u1100-\u11ff]/gu },
  { langs: ['RU', 'UK', 'BG'], re: /[\u0400-\u04ff]/gu },
  { langs: ['AR', 'FA', 'UR'], re: /[\u0600-\u06ff]/gu },
];

const shouldSkipAsTargetLanguage = (text: string, targetLang?: string): boolean => {
  if (!targetLang) return false;
  const code = targetLang.toUpperCase().split(/[-_]/)[0];
  const full = targetLang.toUpperCase();
  const entry = SCRIPT_PATTERNS.find(p => p.langs.includes(full) || p.langs.includes(code));
  if (!entry) return false;
  const letters = text.replace(/\s+/g, '');
  if (letters.length < MIN_MEANINGFUL_LEN) return false;
  const matches = letters.match(entry.re);
  const ratio = (matches?.join('').length ?? 0) / letters.length;
  return ratio > TARGET_LANG_RATIO;
};

// ─── Semantic exclusion ─────────────────────────────────────────────────────

const hasArticleMainSectionAncestor = (el: Element): boolean => {
  let cur: Element | null = el.parentElement;
  while (cur && cur !== document.documentElement) {
    const t = cur.tagName;
    if (t === 'ARTICLE' || t === 'MAIN' || t === 'SECTION') return true;
    cur = cur.parentElement;
  }
  return false;
};

/** True if this element (and its subtree) should be rejected by the scanner. */
const isSemanticallyExcluded = (el: Element): boolean => {
  const tag = el.tagName;

  if (HARD_EXCLUDE_TAGS.has(tag) || SKIP_TAGS.has(tag)) return true;

  if (tag === 'DIALOG' && !(el as HTMLDialogElement).open) return true;

  if (tag === 'NAV') return true;

  if (tag === 'HEADER' || tag === 'FOOTER') {
    if (!hasArticleMainSectionAncestor(el)) return true;
  }

  const role = (el.getAttribute('role') ?? '').toLowerCase().trim();
  if (role && EXCLUDE_ROLES.has(role)) return true;

  if (el.hasAttribute('aria-haspopup') && el.getAttribute('aria-haspopup') !== 'false') return true;

  return false;
};

const hasSourceOrTargetMark = (el: Element): boolean => {
  if (el.hasAttribute(SOURCE_ATTR) || el.hasAttribute(TARGET_ATTR)) return true;
  if (el.classList?.contains(TARGET_CLASS)) return true;
  return false;
};

const hasRecordedAncestor = (el: Element): boolean => {
  let cur: Element | null = el.parentElement;
  while (cur) {
    if (cur.hasAttribute(SOURCE_ATTR)) return true;
    cur = cur.parentElement;
  }
  return false;
};

// ─── Orphaned translation cleanup ───────────────────────────────────────────

/**
 * A target node is owned while its source is still marked: block targets sit
 * right after their source, append-inside targets sit inside it. Anything else
 * is an orphan left behind by a re-render that replaced the source element.
 */
const isOrphanTarget = (t: Element): boolean => {
  if (t.parentElement?.hasAttribute(SOURCE_ATTR)) return false;
  if (t.previousElementSibling?.hasAttribute(SOURCE_ATTR)) return false;
  return true;
};

/**
 * Remove orphaned targets inside and immediately after a fresh candidate, so a
 * re-rendered paragraph is neither double-translated nor serialized with the
 * old translation's text mixed into the new unit.
 */
const sweepOrphanTargets = (el: HTMLElement): void => {
  if (el.querySelector(`[${TARGET_ATTR}]`)) {
    el.querySelectorAll(`[${TARGET_ATTR}]`).forEach(t => {
      if (isOrphanTarget(t)) t.remove();
    });
  }
  let next = el.nextElementSibling;
  while (next && next.hasAttribute(TARGET_ATTR)) {
    const cur = next;
    next = next.nextElementSibling;
    if (isOrphanTarget(cur)) cur.remove();
  }
};

/** textContent with our translation nodes excluded. */
const textExcludingTargets = (el: Element): string => {
  if (!el.querySelector(`[${TARGET_ATTR}]`)) return el.textContent ?? '';
  let out = '';
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    if (!n.parentElement?.closest(`[${TARGET_ATTR}]`)) out += n.nodeValue ?? '';
    n = walker.nextNode();
  }
  return out;
};

// ─── Paragraph-block granularity ────────────────────────────────────────────

const isInlineOnlySubtree = (el: Element): boolean => {
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (child.nodeType !== Node.ELEMENT_NODE) return false;
    const childEl = child as Element;
    if (!INLINE_WHITELIST_TAGS.has(childEl.tagName)) return false;
    if (HARD_EXCLUDE_TAGS.has(childEl.tagName)) return false;
    if (SKIP_TAGS.has(childEl.tagName) && !SERIALIZE_KEEP_TAGS.has(childEl.tagName)) return false;
    if (!isInlineOnlySubtree(childEl)) return false;
  }
  return true;
};

const linkTextLength = (el: Element): number => {
  let total = 0;
  el.querySelectorAll('a').forEach(a => {
    total += (a.textContent ?? '').trim().length;
  });
  return total;
};

const failsLinkDensityHeuristic = (el: Element): boolean => {
  const total = (el.textContent ?? '').trim().length;
  if (total === 0 || total >= LINK_DENSITY_MAX_CHARS) return false;
  const links = linkTextLength(el);
  return links / total > LINK_DENSITY_THRESHOLD;
};

const isBlockCandidate = (el: HTMLElement): boolean => {
  if (BLOCK_TAGS.has(el.tagName)) return true;
  if (!el.isConnected) return false;
  try {
    const d = window.getComputedStyle(el).display;
    return d === 'block' || d === 'list-item' || d === 'flex' || d === 'grid' || d.startsWith('table');
  } catch {
    return false;
  }
};

// ─── Serialization whitelist ────────────────────────────────────────────────

const PLACEHOLDER_RE = /⦃(\d+)⦄/g;

/** Strip translation-side placeholders we injected for discarded nodes. */
const stripDiscardPlaceholders = (html: string): string => html.replace(PLACEHOLDER_RE, '');

const escapeText = (v: string): string => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (v: string): string => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * Serialize a unit element into a clean HTML fragment for translation.
 * Keeps only SERIALIZE_KEEP_TAGS; other elements become ⦃n⦄ placeholders
 * that are stripped on result (default: discard non-text chrome).
 */
const serializeUnitHtml = (el: HTMLElement): string => {
  let discardIndex = 0;

  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return escapeText(node.textContent ?? '');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';

    const child = node as HTMLElement;
    const tag = child.tagName;

    if (tag === 'BR') return '<br>';

    if (SERIALIZE_KEEP_TAGS.has(tag)) {
      const lower = tag.toLowerCase();
      if (tag === 'A') {
        const href = child.getAttribute('href');
        const inner = Array.from(child.childNodes).map(walk).join('');
        if (href) return `<a href="${escapeAttr(href)}">${inner}</a>`;
        return inner;
      }
      const inner = Array.from(child.childNodes).map(walk).join('');
      return `<${lower}>${inner}</${lower}>`;
    }

    // Whitelisted inline wrappers that aren't in SERIALIZE_KEEP (e.g. span): unwrap children.
    if (INLINE_WHITELIST_TAGS.has(tag)) {
      return Array.from(child.childNodes).map(walk).join('');
    }

    // Non-whitelist: index placeholder; text inside is dropped from the send stream
    // (source stays on the page; translation only carries prose).
    const idx = discardIndex++;
    return `⦃${idx}⦄`;
  };

  return Array.from(el.childNodes).map(walk).join('').trim();
};

// ─── Scan ───────────────────────────────────────────────────────────────────

const shouldAcceptWalkerNode = (el: HTMLElement): number => {
  if (hasSourceOrTargetMark(el)) return NodeFilter.FILTER_REJECT;
  if (isSemanticallyExcluded(el)) return NodeFilter.FILTER_REJECT;
  if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
  // Hidden: skip for this pass but do NOT permanently mark — P4 re-scans on attr change.
  if (isHiddenStyle(el)) return NodeFilter.FILTER_REJECT;
  if (el.getAttribute('contenteditable') === 'true') return NodeFilter.FILTER_REJECT;
  return NodeFilter.FILTER_ACCEPT;
};

const tryMakeUnit = (el: HTMLElement, opts: ScanOptions, units: PendingUnit[], counter: { next: number }): boolean => {
  if (hasRecordedAncestor(el)) return false;
  if (hasSourceOrTargetMark(el)) return false;
  if (!isInlineOnlySubtree(el)) return false;

  // Kill leftovers from a previous render BEFORE serializing, otherwise the old
  // translation (a whitelisted <span>) gets unwrapped into the new unit's html.
  sweepOrphanTargets(el);

  const text = textExcludingTargets(el).trim();
  if (!isMeaningfulText(text)) return false;
  if (failsLinkDensityHeuristic(el)) return false;
  if (shouldSkipAsTargetLanguage(text, opts.targetLang)) return false;

  const html = serializeUnitHtml(el);
  const plain = stripDiscardPlaceholders(html)
    .replace(/<[^>]+>/g, '')
    .trim();
  if (!isMeaningfulText(plain)) return false;

  const id = `u${counter.next++}`;
  el.setAttribute(SOURCE_ATTR, '1');
  el.setAttribute(SOURCE_ID_ATTR, id);
  units.push({
    id,
    el,
    html,
    sourceText: text,
    placeholder: null,
    status: 'discovered',
    retries: 0,
    deadline: 0,
  });
  return true;
};

/**
 * Depth-first: for each block-like element, either take it as a paragraph unit
 * (inline-only content) or recurse into children.
 */
const visitBlock = (el: HTMLElement, opts: ScanOptions, units: PendingUnit[], counter: { next: number }): void => {
  if (shouldAcceptWalkerNode(el) === NodeFilter.FILTER_REJECT) return;

  // Block-like: take as a unit when fully inline, otherwise recurse.
  // Bare inline leaves (span/a hanging outside a paragraph) are not units (plan 1.2.3).
  if (isBlockCandidate(el) || el === document.body) {
    if (el !== document.body && tryMakeUnit(el, opts, units, counter)) return;
  }

  for (const child of Array.from(el.children)) {
    visitBlock(child as HTMLElement, opts, units, counter);
  }
};

/**
 * Scan a root for translation units using semantic exclusion + paragraph-block
 * granularity + serialization whitelist.
 */
const scanRoot = (root: ParentNode, opts: ScanOptions): ScanResult => {
  const units: PendingUnit[] = [];
  const counter = { next: opts.nextUnitIndex };

  const start: Element | null =
    root.nodeType === Node.ELEMENT_NODE
      ? (root as Element)
      : root.nodeType === Node.DOCUMENT_NODE
        ? (root as Document).body
        : null;

  if (!start) {
    // Fragment / detached: walk element children
    for (const child of Array.from((root as ParentNode).childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        visitBlock(child as HTMLElement, opts, units, counter);
      }
    }
    return { units, nextUnitIndex: counter.next };
  }

  visitBlock(start as HTMLElement, opts, units, counter);
  return { units, nextUnitIndex: counter.next };
};

/**
 * Incremental scan for mutation targets: scan each root separately.
 */
const scanRoots = (roots: ParentNode[], opts: ScanOptions): ScanResult => {
  let next = opts.nextUnitIndex;
  const units: PendingUnit[] = [];
  for (const root of roots) {
    const r = scanRoot(root, { ...opts, nextUnitIndex: next });
    units.push(...r.units);
    next = r.nextUnitIndex;
  }
  return { units, nextUnitIndex: next };
};

export {
  failsLinkDensityHeuristic,
  isHiddenStyle,
  isMeaningfulText,
  isSemanticallyExcluded,
  scanRoot,
  scanRoots,
  serializeUnitHtml,
  shouldSkipAsTargetLanguage,
  stripDiscardPlaceholders,
  sweepOrphanTargets,
  textExcludingTargets,
};
export type { ScanResult };
