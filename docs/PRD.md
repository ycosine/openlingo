# OpenLingo — Product Requirements Document (v0.1)

> Audience: design + engineering. v0.1 covers the MVP shipped on `main`. Scope past v0.1 is in §10 Roadmap.

## 1. Product One-Liner

**OpenLingo** is an open-source Chrome extension that turns any web page into a **bilingual reading view** — original text on top, translation underneath — driven by the user's own DeepL API key.

It is a self-hosted alternative to closed-source bilingual translators (e.g. 沉浸式翻译). No backend, no telemetry, no subscription — the user brings their own API key.

## 2. Target Users

| Persona | Need | Why OpenLingo |
|---|---|---|
| **Bilingual reader** (researcher, student, dev reading docs) | Read English/Japanese pages with Chinese assist without losing original layout | Bilingual side-by-side, not "replace" |
| **Privacy-conscious user** | Doesn't want page content sent to a closed-source vendor or shared account | Open source, BYO key, requests go straight from browser → DeepL |
| **Tinkerer** | Wants to swap translation backend (DeepL → OpenAI → custom) | `TranslationProvider` interface — drop in another provider file |

Out of scope for v0.1: casual users who don't have a DeepL key (no built-in free tier).

## 3. Goals & Non-Goals

### Goals (v0.1)
1. One-click bilingual translation of the current page, with the translated text visually subordinate (italic, Georgia serif, 90% opacity) to keep the original layout readable.
2. Streaming translation — viewport-visible paragraphs appear within ~1–2 s; rest of the page progressively fills in.
3. Cache so reopening the same page is instant and free (no DeepL calls).
4. Restore the page to pristine original with one click.
5. Zero configuration friction beyond pasting the API key.
6. Provider abstraction so adding a second backend is a single file.

### Non-Goals (v0.1)
- Selection / hover / input-box translation (post-v0.1).
- PDF translation.
- Translating content inside iframes or shadow DOM.
- Translating dropdown `<option>` text or media subtitles.
- Translation memory editing, glossaries, or term lists.
- Side-by-side dual-pane layout (we stay inline).
- Mobile / Safari / Edge-specific UX.

## 4. User Stories

1. As a reader, I open an English Wikipedia article, click the OpenLingo icon, hit **Translate this page**, and within seconds my visible paragraphs have Chinese translations directly beneath them in italic.
2. As a reader, I scroll down — paragraphs further down already show their Chinese translation by the time I reach them.
3. As a reader, I click **Restore original** and the page returns to its untouched state.
4. As a reader, I reopen the same article tomorrow, hit **Translate this page**, and translations appear instantly with no network call.
5. As a new user, I install OpenLingo, click the icon, see "DeepL API key not set", click **Open Options**, paste my key, hit **Test** → see green ✅, hit **Save**, return to my tab and translate.
6. As a curious reader, I scroll into infinite-scroll comments (HN, Twitter-like) — newly loaded comments get auto-translated within ~600 ms.

## 5. Functional Requirements

### 5.1 Popup (toolbar)
- Triggered by clicking the extension icon.
- States:
  - **No API key** → message + button to open Options.
  - **Idle** → shows current target language + primary button `Translate this page`.
  - **Translating** → button disabled, label `Translating…`.
  - **Translated** → primary button becomes `Restore original`.
  - **Error** → error string in red below buttons (e.g. `AUTH: DeepL 403: invalid key`).
- Secondary link/button: `Open Options`.
- Popup queries content script for current page state on open, so reopening the popup reflects reality (popup state is not persisted).

### 5.2 Options page
- Section A: **DeepL API Key**
  - Password-masked input.
  - `Save` (disabled until input changes).
  - `Test` — calls DeepL `/v2/usage` via background SW, shows ✅/❌ inline.
  - Helper text about `:fx` → Free vs no-suffix → Pro auto-detection.
- Section B: **Translation preferences**
  - Target language dropdown (ZH default; EN-US, EN-GB, JA, KO, FR, DE, ES, PT, RU).
  - Source language dropdown (Auto-detect default; same list).
- No theme toggle, no other settings in v0.1.
- All settings persist to `chrome.storage.local` with live sync across tabs.

### 5.3 In-page translation behavior
- **Trigger**: only by user clicking `Translate this page` in popup. No auto-translate.
- **Coverage**: every "leaf text container" element (element with meaningful text and no block-level descendants), unless inside a skip list (`SCRIPT, STYLE, NOSCRIPT, SVG, CANVAS, PRE, CODE, TEXTAREA, INPUT, SELECT, OPTION, IFRAME, IMG, VIDEO, AUDIO, OBJECT, EMBED, MAP, AREA, METER, PROGRESS, TEMPLATE`).
- **Injection**:
  - For block-displayed sources (`<p>, <h1-6>, <div>` styled as block, `<blockquote>`, etc.) → translation appears as a sibling `<span style="display:block">` on the next line.
  - For inline sources (`<a>`, `<button>`, `<span>` in a sentence) → translation appears as an inline sibling `<span>` with a 0.35em left margin, no line break.
  - For elements that can't accept block siblings (`<li>, <td>, <th>, <dt>, <dd>`) → translation is appended inside the element as a block child.
- **Visual style**: italic, Georgia / Times New Roman serif, opacity 0.9. **No border, no background, no padding-left** — translation reads as a subdued echo of the original.
- **Order of arrival**: viewport-visible units translated first; rest fills in.
- **Dynamic content**: a `MutationObserver` (debounced 600 ms) catches newly inserted nodes while in translated state and translates them.
- **Restore**: removes every injected node (`[data-immersive-translated="1"]`) and clears source markers.

### 5.4 Translation backend
- **Provider**: DeepL `/v2/translate` with `tag_handling=html` so inline tags (`<a>, <em>, <strong>, <code>`) survive the round trip.
- **Free vs Pro**: auto-detected. Key ending in `:fx` → `https://api-free.deepl.com`; otherwise → `https://api.deepl.com`.
- **Auth**: `Authorization: DeepL-Auth-Key <key>` header. Always set from the background service worker — the page world never sees the key.
- **Batching**: max **10 texts** per request and **8 KB** total chars per request (well under DeepL's 50-text / 30 KB hard limits — smaller batches let translations stream visibly).
- **Concurrency**: max **3** parallel requests per translation session.
- **Cancellation**: `AbortController` per session. `Restore` or navigation triggers cancel.

### 5.5 Caching
- LRU cache in `chrome.storage.local`, key `translation-cache`.
- Capacity: **2000 entries**, evict oldest on overflow.
- Key formula: `{provider}|{sourceLang}|{targetLang}|normalize(html)`.
- `normalize(html)` strips `class / id / style / data-*` attributes, removes UTM and common tracking params from `href / src`, collapses whitespace — so the same paragraph rendered with different per-build CSS hashes and different tracking params still hits.
- **Trade-off accepted in v0.1**: a cached translation may carry slightly stale tracking params in its `href`. Acceptable because the URL still resolves correctly.

### 5.6 Error handling
- **No API key configured** → `apiKeyMissing` shown in popup, button replaced with "Open Options".
- **DeepL 401/403** → error code `AUTH`, message surfaced in popup.
- **DeepL 429** → error code `RATE_LIMIT`.
- **DeepL 456 (quota exceeded)** → error code `QUOTA_EXCEEDED`.
- **Network failure** → error code `NETWORK`, generic message.
- **Page not injectable** (chrome://, extension page, file://) → popup shows `cannotInjectHere`.
- All errors keep any already-injected translations visible (partial progress preserved).

## 6. Non-Functional Requirements

| Property | Target |
|---|---|
| First viewport translation latency | < 2 s after click (assuming DeepL Free RTT ~800 ms) |
| Memory overhead | < 10 MB per active tab |
| Storage overhead | < 5 MB for cache (well under chrome.storage.local 10 MB cap) |
| API key handling | Never serialized to logs, never sent to anywhere other than DeepL host_permissions. Lives in `chrome.storage.local`. |
| Telemetry | None in v0.1. |
| Offline degradation | Translation fails fast with `NETWORK` error; cached pages still re-translate from cache. |
| Browser support | Chrome (manifest v3) and Firefox (via build:firefox). |

## 7. Information Architecture

```
Toolbar icon
└── Popup
    ├── (no key) → Open Options
    └── (has key)
        ├── Target lang readout
        ├── Translate / Restore button
        └── Open Options link

Options page
├── DeepL API Key section
│   ├── Password input
│   ├── Save button
│   ├── Test button (→ DeepL /v2/usage)
│   └── Validation result line
└── Translation preferences section
    ├── Target language (dropdown)
    └── Source language (dropdown, default Auto-detect)
```

## 8. Design Hand-off Notes

These are the screens the designer needs to produce:

1. **Popup — no key state** (~360 × 220).
2. **Popup — idle, has key** (~360 × 220): logo/wordmark, target lang chip, primary CTA `Translate this page`, link `Open Options`.
3. **Popup — translating state**: same layout, button shows spinner + `Translating…`.
4. **Popup — translated state**: button text becomes `Restore original` (visually secondary — gray, not blue).
5. **Popup — error state**: error message below button in red.
6. **Options page — full layout** (single column, max-width ~640): two cards (API Key, Translation preferences). Include Test result success/failure variants.
7. **In-page translation specimens** (most important — please screenshot real pages):
   - A long-form article: each `<p>` gets a block italic translation directly below it.
   - A navigation bar with buttons/links: each gets an inline italic translation to its right.
   - A list (`<ul>`): each `<li>` gets the translation appended **inside** the bullet (so list markers don't break).
   - A table (`<td>`): same — translation appended inside the cell.

### Visual language requests
- Brand color: a single calm hue (designer's call) — should differentiate clearly from 沉浸式翻译's pink (`#ED6D8F`). Suggested directions: deep teal, indigo, slate.
- Typography for the translation overlay: **Georgia / Times New Roman serif, italic, opacity 0.9**. This is the deliberate "subordinate echo" treatment — already in code; designer to confirm or propose alternative.
- No borders, no backgrounds on translation blocks. Page authenticity > attention-grabbing.
- Logo: simple wordmark "OpenLingo" + tiny mark; mark should read as a "speech / translation bubble", not a globe (too generic).

## 9. Acceptance Criteria (for the v0.1 ship)

- [ ] Popup opens within 200 ms of icon click on a page where the content script has run.
- [ ] On a Wikipedia article (>50 paragraphs), first viewport translates within 2 s on a DeepL Free key.
- [ ] Inline links in translated paragraphs preserve their `href` and underline style.
- [ ] Reopening the same Wikipedia tab on a fresh browser session and translating again triggers **zero** DeepL requests (verifiable in background SW Network tab).
- [ ] Restore returns the DOM to byte-identical state (no leftover `data-immersive-*` attributes, no leftover style tag's effect).
- [ ] On `chrome://extensions` (uninjectable page), popup shows `cannotInjectHere` instead of silently failing.
- [ ] Invalid API key surfaces a red `AUTH: ...` message in popup; valid key passes `Test`.

## 10. Roadmap (post-v0.1)

| Phase | Feature |
|---|---|
| v0.2 | Selection-to-translate (highlight text → popup tooltip with translation) |
| v0.2 | Keyboard shortcut to translate / restore current page |
| v0.3 | Hover-paragraph translate (Alt + hover) |
| v0.3 | Additional providers: Google Translate, OpenAI-compatible endpoints (incl. self-hosted) |
| v0.4 | Display style picker (block / inline / replace / dashed underline) |
| v0.4 | Domain rules — auto-translate certain domains, never-translate others |
| v0.5 | PDF in-browser bilingual translation |
| v0.5 | Glossary support (DeepL glossary IDs) |
| Later | iframe + shadow DOM support; Firefox parity polish; i18n beyond en/ko |

## 11. Open Questions for Design

1. Should the **target language chip** in the popup show the language name in its native script (`中文`) or the language code (`ZH`)? Engineering bias: native name. Confirm.
2. Should the **Test** result in Options also display the DeepL usage (e.g. "44 / 500,000 characters used this month")? It's one extra parse step.
3. Do we want an explicit **brand mark** (icon + wordmark together) shown in the popup header, or just the wordmark?
4. Empty-state illustration: should the "no API key" state have any artwork, or is plain text fine?

---

*Owner: @yuxianjun · Eng contact: this repo's commit history. Last updated: 2026-05-22.*
