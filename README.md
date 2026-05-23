<div align="center">
  <img src="docs/icon-128.png" alt="OpenLingo" width="96" height="96" />
  <h1>OpenLingo</h1>
  <p><strong>Bilingual reading & subtitles for the open web.</strong></p>
  <p>Original on top, translation underneath — for webpages and YouTube. Bring your own provider. No subscription.</p>
  <p>
    <strong>English</strong> · <a href="README_ZH.md">中文</a>
  </p>
</div>

---

## What it does

- **One-click bilingual webpages.** Click the toolbar icon, every paragraph gets a translation line right below it; the original stays untouched.
- **YouTube bilingual subtitles.** Auto-engages when you turn on YouTube's CC. The translated line floats just below YouTube's own caption, scaled to the player and the font size you choose.
- **Bring your own translator.** Pick from:
  - **Google (free)** — works out of the box, no key needed.
  - **DeepL** — paste your `:fx` (Free) or Pro key for higher quality.
  - **OpenAI-compatible** — point it at GPT-4o-mini, Claude via proxy, Groq, DeepSeek, local Ollama, whatever speaks the OpenAI Chat Completions API.
- **Streaming translation.** What's on screen translates first; the rest streams in as you scroll.
- **Local cache.** Translated once, free forever — survives reloads and SPA route changes.
- **Restore in one click.** Toggle off and the page is back to the way you found it.

## YouTube features

When you open a YouTube video with captions enabled, OpenLingo adds a small button into the player's right controls (next to the CC button). Click it to get a menu showing:

- The active caption source (`USING AI CAPTIONS` for YouTube's auto-generated track, `USING HUMAN CAPTIONS` for an authored track).
- A toggle for bilingual subtitles on this video.
- **Hide this button** for the rest of the video.
- **Download .srt** — exports the original + translated cues as a standard SubRip file.
- **Caption settings…** — opens the Options page.

If CC is off, the menu shows a one-click "Turn on CC" prompt that flips YouTube's own captions on.

## Install

1. Grab `dist.zip` from a release (or build it yourself — see below) and unzip.
2. Open Chrome → `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped `dist/` folder.

Firefox: use `dist-firefox.zip`, then **Load Temporary Add-on** at `about:debugging`.

## Set up

1. Click the OpenLingo toolbar icon → **Open Options** (or right-click the icon → **Options**).
2. Pick a provider:
   - Google (free) needs no setup.
   - DeepL: paste your key from [deepl.com/pro-api](https://www.deepl.com/pro-api) (`:fx` ending = Free tier).
   - OpenAI-compatible: paste a base URL (e.g. `https://api.openai.com/v1`), API key, and model name.
3. Choose your target language (default: Chinese).
4. (Optional) In **Bilingual video subtitles**, pick a subtitle style and font size — S / M / L / XL on top of YouTube's own scaling.

Keys live in `chrome.storage.local`. They never leave your browser.

## Use it

- **A webpage**: click the toolbar icon → **Translate this page**. Click again to **Restore**.
- **A YouTube video**: turn on YouTube's CC. OpenLingo's button lights up and bilingual subtitles appear in a few seconds.

## FAQ

**Why are some places not translated?**
Code blocks, `<pre>` content, pure numbers, and paragraphs already in the target language are skipped on purpose.

**Why does the YouTube button do nothing?**
YouTube only emits the caption track URL after CC is enabled in the player. Use the button's menu — it has a "Turn on CC" shortcut.

**DeepL says 456 / quota exceeded?**
You're out of monthly characters. Rotate to another key, switch provider, or wait for the next reset. Cached translations keep displaying.

**Does it phone home?**
No telemetry. Text is sent only to the translation provider you've configured, and only when you actively trigger translation (click the toolbar button or turn on YouTube CC).

## Build it yourself

```bash
pnpm install
pnpm build           # → dist/ (Chromium)
pnpm build:firefox   # → dist/ (Firefox)
pnpm zip             # → dist.zip
```

Requires Node 22+ and pnpm 10+.

## License

MIT.
