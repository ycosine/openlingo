<div align="center">
  <img src="docs/icon-128.png" alt="OpenLingo" width="96" height="96" />
  <h1>OpenLingo</h1>
  <p><strong>开放网络的双语阅读与字幕。</strong></p>
  <p>原文在上、译文在下——网页和 YouTube 都支持。自带翻译服务，零订阅。</p>
  <p>
    <a href="README.md">English</a> · <strong>中文</strong>
  </p>
</div>

---

## 它是什么

- **网页一键双语对照。**点工具栏图标，每一段下面冒出译文，原文保留不动。
- **YouTube 双语字幕。**打开 YouTube 的 CC 字幕后自动启用；如果视频没有字幕轨道，Chrome 116+ 可以选用你自己的 ElevenLabs API Key，通过 Scribe 实时转写音频。
- **翻译服务自选。**支持：
  - **Google (免费)** — 开箱即用，不需要 Key。
  - **DeepL** — 粘贴 `:fx`（免费版）或 Pro Key，质量更高。
  - **OpenAI 兼容**——支持任何走 Chat Completions 接口的服务，比如 GPT-4o-mini、走代理的 Claude、Groq、DeepSeek、本地 Ollama 等。
- **流式翻译。**先翻你正在看的部分，剩下的边滚边翻。
- **本地缓存。**同段文字翻过一次就记住，刷新、路由切换不再消耗额度。
- **一键还原。**再点一下，所有译文消失，页面回到原样。

## YouTube 功能详情

打开一个开启了字幕的 YouTube 视频时，OpenLingo 会在播放器右下控制条插入一个图标（CC 按钮附近）。点击它会弹出菜单：

- 顶部状态栏显示当前字幕来源：`USING AI CAPTIONS`（YouTube 自动生成）或 `USING HUMAN CAPTIONS`（人工字幕）。
- 「Bilingual on/off for this video」勾选项——当前视频是否启用双语字幕。
- **Hide this button**——本视频内隐藏 OpenLingo 图标，下个视频自动恢复。
- **Download .srt**——把当前 cue + 译文导出为标准 SubRip 文件（每条 2 行：原文 / 译文）。
- **Caption settings…**——跳转到设置页。

如果检测到 CC 未打开，菜单顶部会显示一个琥珀色的「Turn on CC」按钮，点一下直接帮你打开 YouTube 的 CC。

如果视频确实没有 YouTube 字幕轨道，打开工具栏弹窗并点击 **Start live transcription**。原文会先实时出现，译文随后显示在下一行。此兜底功能目前只支持 Chromium。

## 安装

1. 从 Release 下载 `dist.zip`（或自己 build，见底部）并解压。
2. 打开 Chrome，访问 `chrome://extensions`。
3. 右上角打开**开发者模式**。
4. 点**加载已解压的扩展程序**，选解压后的 `dist/` 目录。

Firefox 用户：用 `dist-firefox.zip`，在 `about:debugging` 里加载临时附加组件。

## 配置

1. 点工具栏的 OpenLingo 图标 → **Open Options**（或右键图标 → **选项**）。
2. 选一个翻译服务：
   - **Google (免费)**：不用配置。
   - **DeepL**：去 [deepl.com/pro-api](https://www.deepl.com/pro-api) 注册拿 Key 粘贴（`:fx` 结尾是免费版，每月 50 万字符额度）。
   - **OpenAI 兼容**：填 Base URL（例如 `https://api.openai.com/v1`）、API Key、模型名。
3. 选目标语言（默认中文）。
4. （可选）进入 **Bilingual video subtitles** → 选字幕样式和字号（S / M / L / XL，叠加在 YouTube 自身字号之上）。
5. （可选）遇到无字幕视频时，打开 **Live transcription fallback**，填入 ElevenLabs API Key，并选择自动识别或固定源语言。

所有 Key 都只存在浏览器本地的 `chrome.storage.local`。翻译 Key 只会发送给对应的翻译服务；当弹窗检测到无字幕的 YouTube 视频时，ElevenLabs Key 会被用于换取一个短时效的转写 token；音频只有在你明确点击开始后才会被采集和发送。

## 使用

- **翻译网页**：点工具栏图标 → **Translate this page**。再点一下变成 **Restore** 还原。
- **YouTube 字幕**：打开 YouTube 自带的 CC 字幕，OpenLingo 几秒后开始翻译，译文会跟在原字幕下方一行。
- **没有字幕的 YouTube 视频**：点工具栏图标 → **Start live transcription**。

## 常见问题

**为什么有些地方没翻译？**
代码块、`<pre>` 内容、纯数字、已经是目标语言的段落会被跳过——这是故意的。

**YouTube 图标点了没反应？**
YouTube 只有在你打开 CC 字幕后才会把字幕轨道 URL 发出来。点开菜单里的「Turn on CC」按钮即可。

**DeepL 报 456？**
你这个月的额度用完了。换 Key、换 provider，或者等下个月。本地缓存里翻过的内容仍可继续显示。

**会上传我的数据吗？**
不做任何遥测。文本只发送给你配置的翻译服务。只有当你明确点击开始实时转写后，当前标签页的音频才会持续发送给 ElevenLabs；停止转写、离开视频或检测到原生字幕轨道后就会结束。

## 自己构建

```bash
pnpm install
pnpm build           # 产出 dist/（Chromium）
pnpm build:firefox   # 产出 dist/（Firefox）
pnpm zip             # 产出 dist.zip
```

需要 Node 22+、pnpm 10+。

## 许可

MIT.
