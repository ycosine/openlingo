<div align="center">
  <img src="docs/icon-128.png" alt="OpenLingo" width="96" height="96" />
  <h1>OpenLingo</h1>
  <p><strong>Bilingual reading & subtitles for the open web.</strong></p>
  <p>Original on top, translation underneath — for webpages and YouTube. Bring your own provider. No subscription.</p>
  <p>
    <a href="#english">English</a> · <a href="#中文">中文</a>
  </p>
</div>

---

## English

### What it does

- **One-click bilingual webpages.** Click the toolbar icon, every paragraph gets a translation line right below it; the original stays untouched.
- **YouTube bilingual subtitles.** Auto-engages when you turn on YouTube's CC. The translated line floats just below YouTube's own caption, scaled to the player and the font size you choose.
- **Bring your own translator.** Pick from:
  - **Google (free)** — works out of the box, no key needed.
  - **DeepL** — paste your `:fx` (Free) or Pro key for higher quality.
  - **OpenAI-compatible** — point it at GPT-4o-mini, Claude via proxy, Groq, DeepSeek, local Ollama, whatever speaks the OpenAI Chat Completions API.
- **Streaming translation.** What's on screen translates first; the rest streams in as you scroll.
- **Local cache.** Translated once, free forever — survives reloads and SPA route changes.
- **Restore in one click.** Toggle off and the page is back to the way you found it.

### YouTube features

When you open a YouTube video with captions enabled, OpenLingo adds a small button into the player's right controls (next to the CC button). Click it to get a menu showing:

- The active caption source (`USING AI CAPTIONS` for YouTube's auto-generated track, `USING HUMAN CAPTIONS` for an authored track).
- A toggle for bilingual subtitles on this video.
- **Hide this button** for the rest of the video.
- **Download .srt** — exports the original + translated cues as a standard SubRip file.
- **Caption settings…** — opens the Options page.

If CC is off, the menu shows a one-click "Turn on CC" prompt that flips YouTube's own captions on.

### Install

1. Grab `dist.zip` from a release (or build it yourself — see below) and unzip.
2. Open Chrome → `chrome://extensions`.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and pick the unzipped `dist/` folder.

Firefox: use `dist-firefox.zip`, then **Load Temporary Add-on** at `about:debugging`.

### Set up

1. Click the OpenLingo toolbar icon → **Open Options** (or right-click the icon → **Options**).
2. Pick a provider:
   - Google (free) needs no setup.
   - DeepL: paste your key from [deepl.com/pro-api](https://www.deepl.com/pro-api) (`:fx` ending = Free tier).
   - OpenAI-compatible: paste a base URL (e.g. `https://api.openai.com/v1`), API key, and model name.
3. Choose your target language (default: Chinese).
4. (Optional) In **Bilingual video subtitles**, pick a subtitle style and font size — S / M / L / XL on top of YouTube's own scaling.

Keys live in `chrome.storage.local`. They never leave your browser.

### Use it

- **A webpage**: click the toolbar icon → **Translate this page**. Click again to **Restore**.
- **A YouTube video**: turn on YouTube's CC. OpenLingo's button lights up and bilingual subtitles appear in a few seconds.

### FAQ

**Why are some places not translated?**
Code blocks, `<pre>` content, pure numbers, and paragraphs already in the target language are skipped on purpose.

**Why does the YouTube button do nothing?**
YouTube only emits the caption track URL after CC is enabled in the player. Use the button's menu — it has a "Turn on CC" shortcut.

**DeepL says 456 / quota exceeded?**
You're out of monthly characters. Rotate to another key, switch provider, or wait for the next reset. Cached translations keep displaying.

**Does it phone home?**
No telemetry. Text is sent only to the translation provider you've configured, and only when you actively trigger translation (click the toolbar button or turn on YouTube CC).

### Build it yourself

```bash
pnpm install
pnpm build           # → dist/ (Chromium)
pnpm build:firefox   # → dist/ (Firefox)
pnpm zip             # → dist.zip
```

Requires Node 22+ and pnpm 10+.

### License

MIT.

---

## 中文

### 它是什么

- **网页一键双语对照。**点工具栏图标，每一段下面冒出译文，原文保留不动。
- **YouTube 双语字幕。**打开 YouTube 的 CC 字幕后自动启用，译文一行紧贴在原字幕下方，跟随播放器尺寸和你设定的字号缩放。
- **翻译服务自选。**支持：
  - **Google (免费)** — 开箱即用，不需要 Key。
  - **DeepL** — 粘贴 `:fx`（免费版）或 Pro Key，质量更高。
  - **OpenAI 兼容**——支持任何走 Chat Completions 接口的服务，比如 GPT-4o-mini、走代理的 Claude、Groq、DeepSeek、本地 Ollama 等。
- **流式翻译。**先翻你正在看的部分，剩下的边滚边翻。
- **本地缓存。**同段文字翻过一次就记住，刷新、路由切换不再消耗额度。
- **一键还原。**再点一下，所有译文消失，页面回到原样。

### YouTube 功能详情

打开一个开启了字幕的 YouTube 视频时，OpenLingo 会在播放器右下控制条插入一个图标（CC 按钮附近）。点击它会弹出菜单：

- 顶部状态栏显示当前字幕来源：`USING AI CAPTIONS`（YouTube 自动生成）或 `USING HUMAN CAPTIONS`（人工字幕）。
- 「Bilingual on/off for this video」勾选项——当前视频是否启用双语字幕。
- **Hide this button**——本视频内隐藏 OpenLingo 图标，下个视频自动恢复。
- **Download .srt**——把当前 cue + 译文导出为标准 SubRip 文件（每条 2 行：原文 / 译文）。
- **Caption settings…**——跳转到设置页。

如果检测到 CC 未打开，菜单顶部会显示一个琥珀色的「Turn on CC」按钮，点一下直接帮你打开 YouTube 的 CC。

### 安装

1. 从 Release 下载 `dist.zip`（或自己 build，见底部）并解压。
2. 打开 Chrome，访问 `chrome://extensions`。
3. 右上角打开**开发者模式**。
4. 点**加载已解压的扩展程序**，选解压后的 `dist/` 目录。

Firefox 用户：用 `dist-firefox.zip`，在 `about:debugging` 里加载临时附加组件。

### 配置

1. 点工具栏的 OpenLingo 图标 → **Open Options**（或右键图标 → **选项**）。
2. 选一个翻译服务：
   - **Google (免费)**：不用配置。
   - **DeepL**：去 [deepl.com/pro-api](https://www.deepl.com/pro-api) 注册拿 Key 粘贴（`:fx` 结尾是免费版，每月 50 万字符额度）。
   - **OpenAI 兼容**：填 Base URL（例如 `https://api.openai.com/v1`）、API Key、模型名。
3. 选目标语言（默认中文）。
4. （可选）进入 **Bilingual video subtitles** → 选字幕样式和字号（S / M / L / XL，叠加在 YouTube 自身字号之上）。

所有 Key 都只存在浏览器本地的 `chrome.storage.local`，不会上传到任何第三方服务。

### 使用

- **翻译网页**：点工具栏图标 → **Translate this page**。再点一下变成 **Restore** 还原。
- **YouTube 字幕**：打开 YouTube 自带的 CC 字幕，OpenLingo 几秒后开始翻译，译文会跟在原字幕下方一行。

### 常见问题

**为什么有些地方没翻译？**
代码块、`<pre>` 内容、纯数字、已经是目标语言的段落会被跳过——这是故意的。

**YouTube 图标点了没反应？**
YouTube 只有在你打开 CC 字幕后才会把字幕轨道 URL 发出来。点开菜单里的「Turn on CC」按钮即可。

**DeepL 报 456？**
你这个月的额度用完了。换 Key、换 provider，或者等下个月。本地缓存里翻过的内容仍可继续显示。

**会上传我的数据吗？**
不做任何遥测。文本只会在你**主动触发翻译**（点工具栏按钮、打开 YouTube CC）时发送到你配置的那家翻译服务。设置和缓存只存本地，不同步、不上传。

### 自己构建

```bash
pnpm install
pnpm build           # 产出 dist/（Chromium）
pnpm build:firefox   # 产出 dist/（Firefox）
pnpm zip             # 产出 dist.zip
```

需要 Node 22+、pnpm 10+。

### 许可

MIT.
