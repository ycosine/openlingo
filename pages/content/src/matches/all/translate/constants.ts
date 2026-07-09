export const SOURCE_ATTR = 'data-immersive-source';
export const SOURCE_ID_ATTR = 'data-immersive-source-id';
export const TARGET_ATTR = 'data-immersive-translated';
export const TARGET_CLASS = 'immersive-translate-target';
export const LOADING_CLASS = `${TARGET_CLASS}--loading`;
export const BLOCK_CLASS = `${TARGET_CLASS}--block`;
export const INLINE_CLASS = `${TARGET_CLASS}--inline`;
export const STYLE_ELEMENT_ID = 'immersive-translate-style';

/** Tags whose entire subtree is never walked or translated. */
export const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'CANVAS',
  'PRE',
  'CODE',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'OPTION',
  'IFRAME',
  'IMG',
  'VIDEO',
  'AUDIO',
  'OBJECT',
  'EMBED',
  'MAP',
  'AREA',
  'METER',
  'PROGRESS',
  'TEMPLATE',
  'BUTTON',
  'LABEL',
  'DATALIST',
  'OUTPUT',
]);

/** Hard-exclude tags (self + subtree). DIALOG is handled separately when not open. */
export const HARD_EXCLUDE_TAGS = new Set(['BUTTON', 'LABEL', 'OPTION', 'DATALIST', 'OUTPUT']);

/** Block-level / structural tags used for paragraph-block unit discovery. */
export const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'SECTION',
  'ARTICLE',
  'HEADER',
  'FOOTER',
  'MAIN',
  'NAV',
  'ASIDE',
  'UL',
  'OL',
  'LI',
  'TABLE',
  'THEAD',
  'TBODY',
  'TFOOT',
  'TR',
  'TD',
  'TH',
  'CAPTION',
  'FORM',
  'FIELDSET',
  'LEGEND',
  'BLOCKQUOTE',
  'ADDRESS',
  'FIGURE',
  'FIGCAPTION',
  'DETAILS',
  'SUMMARY',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'DL',
  'DT',
  'DD',
  'HR',
]);

/** Tags that receive block translation as an inner child (not a sibling). */
export const APPEND_INSIDE_TAGS = new Set(['LI', 'TD', 'TH', 'DT', 'DD']);

/**
 * Inline semantic tags allowed inside a paragraph-block unit.
 * Custom / interactive / media children force recursion instead of whole-unit translate.
 */
export const INLINE_WHITELIST_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'BDI',
  'BDO',
  'BR',
  'CITE',
  'CODE',
  'DATA',
  'DFN',
  'EM',
  'I',
  'KBD',
  'MARK',
  'Q',
  'RP',
  'RT',
  'RUBY',
  'S',
  'SAMP',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
  'VAR',
  'WBR',
  'DEL',
  'INS',
]);

/** Tags preserved in serialized HTML sent to the translator (with limited attrs). */
export const SERIALIZE_KEEP_TAGS = new Set(['A', 'STRONG', 'B', 'EM', 'I', 'CODE', 'SUB', 'SUP', 'BR']);

/** ARIA roles whose subtree is treated as chrome/controls, not body copy. */
export const EXCLUDE_ROLES = new Set([
  'navigation',
  'menu',
  'menubar',
  'toolbar',
  'tablist',
  'tab',
  'button',
  'listbox',
  'combobox',
  'slider',
  'switch',
  'tooltip',
]);

export const VIEWPORT_ROOT_MARGIN = '300px 0px';
export const FLUSH_INTERVAL_MS = 150;
export const FLUSH_BATCH_SIZE = 8;
export const UNIT_DEADLINE_MS = 20_000;
export const RETRY_DELAYS_MS = [1000, 4000] as const;
export const MAX_RETRIES = 2;
export const MUTATION_DEBOUNCE_MS = 600;
export const LINK_DENSITY_MAX_CHARS = 120;
export const LINK_DENSITY_THRESHOLD = 0.5;
export const MIN_MEANINGFUL_LEN = 4;
export const TARGET_LANG_RATIO = 0.6;
