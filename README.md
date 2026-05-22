# OpenLingo

Open-source bilingual page translator for Chrome. Translate any web page in place — original above, translation below — using your own DeepL API key.

## Features

- One-click bilingual page translation (block paragraphs get block translations, inline links/buttons get inline translations).
- DeepL Free (`:fx` keys → `api-free.deepl.com`) and DeepL Pro (`api.deepl.com`) auto-detected from the key suffix.
- Streaming translation: viewport-prioritized batches, 3-way concurrent requests, results inject as they arrive.
- LRU translation cache (2000 entries, persisted in `chrome.storage.local`) — same page reopened costs zero requests.
- Provider abstraction (`packages/translation`) — DeepL today, easy to add Google / OpenAI / custom OpenAI-compatible endpoints later.
- Minimal DOM intrusion: each translation is a single `<span>` sibling (or in-cell append for `<li>/<td>`), italic Georgia, no borders/backgrounds.

## Repo layout

```
chrome-extension/        manifest + background service worker (translator orchestration)
pages/
  popup/                 toolbar UI: translate / restore button, status, link to options
  options/               settings page: DeepL API key + target/source language
  content/               content script: DOM walker, injector, mutation observer
packages/
  translation/           provider interface + DeepL implementation
  storage/               typed wrappers around chrome.storage.local
  i18n/                  chrome.i18n.getMessage() helper + locale JSON
  shared/ ui/ env/ hmr/ vite-config/ ...   build & runtime infra
```

## Run locally

```bash
pnpm install
pnpm dev        # turbo watch — rebuilds dist/ on save, content script HMR
```

Then in Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

Open the extension's Options page and paste your DeepL API key (Free keys end in `:fx`). Hit **Test** to confirm, then **Save**.

## Build

```bash
pnpm build           # Chrome
pnpm build:firefox   # Firefox
pnpm zip             # Chrome dist.zip
pnpm zip:firefox     # Firefox dist.zip
```

## License

MIT.
