# 页面翻译链路重构方案

针对三个已确认的架构问题：① 翻译单元选择是纯结构判断，导致按钮/导航/整排控件被翻译甚至被复制；② 翻译单元没有生命周期管理，loading 占位符会永久卡死、出错后无法恢复；③ 动态内容发现机制启动晚、看不到属性变化、且全量重扫昂贵。

涉及的现有代码：

- `pages/content/src/matches/all/immersive-translate.ts` — 全部重写，拆分为模块
- `chrome-extension/src/background/translator.ts` — 队列与会话管理重写，缓存/分批逻辑保留
- `packages/translation/*` — **不动**（provider 接口、`TranslationError`、缓存 key 设计均保留）
- `pages/popup/src/Popup.tsx` — 协议兼容，仅扩展 `TR_PAGE_STATE` 返回值

---

## 目标模块结构

```
pages/content/src/matches/all/translate/
  index.ts        # 消息入口 + 会话状态机（对应现在的 initImmersiveTranslate）
  scanner.ts      # 正文识别：找翻译单元 + 序列化
  scheduler.ts    # 单元生命周期：队列、超时、重试、视口观察
  renderer.ts     # 占位符 / 译文回填 / 还原（对应现在的 placeTargetNode 等）
  transport.ts    # 基于 Port 的收发 + 断线重连
```

后台 `translator.ts` 拆为 `translate-session.ts`（每 tab 一个会话对象：队列 + 全局并发 + 退避）与 `translator.ts`（Port 接线）。

---

## Phase 1 — 正文识别层（scanner.ts）

解决"翻译按钮和 action"。这一阶段独立可上线，收益最大。

### 1.1 语义排除规则（新增）

在现有 `SKIP_TAGS` 结构过滤之上，增加两类排除：

**硬排除标签**（自身及子树跳过）：`BUTTON`、`LABEL`、`OPTION`、`DATALIST`、`OUTPUT`、`DIALOG`（未 open 时）。

**祖先语义排除**（TreeWalker 的 `acceptNode` 里 REJECT 整棵子树）：

- `NAV` 元素
- `role` 属性为 `navigation | menu | menubar | toolbar | tablist | tab | button | listbox | combobox | slider | switch | tooltip` 的元素
- `aria-haspopup` 非空的元素
- 直接位于 `body` 布局层的 `HEADER` / `FOOTER`（即最近的 `article`/`main`/`section` 祖先不存在时）——文章内部的 header/标题仍然翻译

**链接密度启发式**（导航/菜单最可靠的特征）：候选单元中 `<a>` 后代的文本长度占比 > 50% 且总文本 < 120 字符 → 跳过。新闻正文里的内联链接不受影响（占比低）。

### 1.2 单元粒度：从"叶子容器"改为"段落块"

现在的 `isLeafTextContainer` 会把"一个装满 `<button>`/`<span>` 的 div 工具栏"当成一个单元整体送翻。改为：

1. 自顶向下找**块级元素**，其内部若只含 inline 内容（文本、`a`、`strong`、`em`、`code`、`span`、`br` 等 inline 白名单）→ 成为一个单元；
2. 块内含**交互或非白名单子元素**（button、input、svg、自定义组件等）→ 不作为整体单元，继续向下递归，只把其中纯文本的子块作为单元;
3. inline 元素（如裸 `<a>`、`<span>` 直接挂在排除区之外）不再单独成为单元——只有位于段落块内才随块被翻译。这直接取消了现在 `placeTargetNode` 里"译文塞进按钮/链接内部"的路径（immersive-translate.ts:246 的 inline 分支保留仅用于 `APPEND_INSIDE_TAGS` 场景）。

### 1.3 序列化白名单（送翻内容清洗）

现在直接发 `unit.el.innerHTML`，标签原样进 DeepL 又原样回填，这是"控件被复制"的直接原因。改为 scanner 输出规范化片段：

- 保留 inline 语义标签白名单：`a`（仅 href）、`strong`、`b`、`em`、`i`、`code`、`sub`、`sup`、`br`
- 其余子节点（svg、img、button、自定义元素…）替换为索引占位符 `⦃n⦄`，原节点引用存在单元对象上，译文回填时按占位符还原为**克隆节点**或直接丢弃（默认丢弃，译文只保留文字流）
- 后台已有的 `htmlToPlain`/`restorePlaceholders`（translator.ts:106–119）语义不变，继续服务 `preservesHtml=false` 的 provider

### 1.4 语言过滤

- 目标语言字符占比启发式：目标为 `zh` 时，候选文本 CJK 字符占比 > 60% → 跳过（对其他语言对同理，做一个小的字符集映射表）
- 有条件时用 `chrome.i18n.detectLanguage()` 异步校正（batch 发送前在后台做，命中目标语言的单元直接回 `TR_TRANSLATE_RESULT` 空结果，内容侧移除占位符）
- `isMeaningfulText` 最小长度从 2 提到 4（配合语义排除后，正文里的短文本已很少）

### 验收

用 jsdom 固定 HTML 快照写 scanner 单测（`tests/` 下）：新闻文章页、GitHub issue 页、带无限滚动的列表页三个样例，断言"被选中的单元集合"精确匹配。手工验收：GitHub / Hacker News / 任意新闻站，确认导航、按钮、工具栏零翻译。

---

## Phase 2 — 单元生命周期（scheduler.ts + renderer.ts）

解决"loading 不稳定"的内容侧一半。

### 2.1 单元状态机

`PendingUnit` 的 `sent/done` 两个布尔改为显式状态：

```
discovered → queued → sent → done
                        ↓ (超时 / 会话错误 / 断线)
                      failed(retryable) → queued   [最多重试 2 次，间隔 1s/4s]
                        ↓ (重试耗尽 / 不可重试错误码)
                      failed(final)                 [移除占位符，popup 计数]
```

- **每个 sent 单元带 deadline（20s）**，由 scheduler 的单个心跳定时器统一检查。超时 → 回 `queued` 重发；重试耗尽 → 移除 spinner，静默放弃，`TR_PAGE_STATE` 返回 `failedCount` 供 popup 展示"N 段翻译失败，点击重试"。
- **错误分级**：`NO_API_KEY`/`AUTH` → 不可重试，终止会话并全部还原占位符（现有行为）；`RATE_LIMIT`/`HTTP_ERROR`/超时/断线 → 仅影响 in-flight 单元，回队列。
- **修复 unobserve 后无法恢复的问题**：失败回 `queued` 的单元已知在视口内，直接重新入队，不依赖 IntersectionObserver。

### 2.2 发送节拍

`enqueueForTranslation` 的 80ms debounce 改为**固定节拍 flush**：队列非空时每 150ms 或累积满 8 条即发（先到者触发），连续滚动时不会无限顺延，也天然给后台喂大小均匀的批次。

---

## Phase 3 — 传输与后台队列（transport.ts + translate-session.ts）

解决"loading 不稳定"的后台一半和滚动时的限流雪崩。

### 3.1 Port 化传输

`chrome.runtime.sendMessage` fire-and-forget 改为 `chrome.runtime.connect({ name: 'translate' })` 长连接：

- **`port.onDisconnect`（内容侧）**：service worker 被杀 / 崩溃时立即感知 → 所有 `sent` 单元回滚为 `queued` → 重连 → 重发。这是 spinner 永久卡死的根治手段，比任何 keepalive 都可靠。
- **`port.onDisconnect`（后台侧）**：tab 关闭/导航时 abort 该会话全部 in-flight 请求，替代现在靠 `sendMessage` 失败静默吞掉的做法。
- 消息类型不变（`TR_TRANSLATE_BATCH` / `TR_TRANSLATE_RESULT` / `TR_TRANSLATE_ERROR`），只换通道；`TR_PAGE_*`（popup ↔ content）继续走 `sendMessage`，不受影响。

### 3.2 每 tab 单一会话队列

现在每条 batch 消息各自起 `runWithConcurrency(3)`，全局并发无上限（translator.ts:228），且同 session 的 AbortController 互相覆盖（translator.ts:190）。改为：

- 后台按 Port 维护一个 `TranslateSession` 对象：**单一 FIFO 队列 + 全局并发 3（整个会话共享）+ 单个 AbortController**。新到的 batch 消息只是往队列 push，worker 循环消费。
- cancel = `controller.abort()` + 清队列，一次性中止所有 in-flight。竞态消失。

### 3.3 限流退避

worker 循环里对 `RATE_LIMIT`（429）做指数退避：暂停整个队列 1s → 4s → 10s 后重试当前批次，最多 3 次；期间不向页面报错（单元仍在 `sent` 状态，受 Phase 2 的 20s 超时保护——退避上限需 < 单元超时，或退避时通知内容侧顺延 deadline，取后者：发一条 `TR_TRANSLATE_BACKOFF` 让 scheduler 给 in-flight 单元续 15s）。重试耗尽才发 `TR_TRANSLATE_ERROR`。

`TranslateResultMessage.done` 字段删除——内容侧已不依赖它（immersive-translate.ts:352 注释已说明），留着只会造成语义混乱。

---

## Phase 4 — 动态内容发现

解决"滚动翻页不稳定"的剩余部分。

1. **MutationObserver 随 `startTranslate` 立即启动**，不再等首批结果（修复 immersive-translate.ts:355-358 的延迟启动）。
2. **监听范围**：`childList + subtree` 之外增加 `attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']`——tab 切换、手风琴展开这类"靠改 class 显示"的内容才能被发现。相应地，`collectCandidates` 遇到隐藏元素时**不再打标记永久拒绝**，留待属性变化时重新评估。
3. **增量扫描**：不再全量扫 `document.body`，只对 mutation records 的 `addedNodes` 和属性变化的 `target` 子树跑 scanner；records 里凡是带 `TARGET_ATTR` 或落在译文节点内的直接跳过，杜绝"自己插占位符 → 触发 mutation → 重置计时器"的自反馈循环。
4. debounce 600ms 保留，但改为对"待扫子树集合"去重累积，到点批量扫，而不是重置后全量扫。

---

## 不变的部分

- `packages/translation` 的 provider 接口和三个实现（deepl / google-free / openai-compatible）
- 缓存设计：`normalizeForCacheKey` 的属性剥离 + 追踪参数清洗（translator.ts:89）照旧；序列化白名单会让缓存 key 更稳定，是顺带收益
- popup 协议：`TR_PAGE_TRANSLATE` / `TR_PAGE_RESTORE` / `TR_PAGE_STATE` 语义不变，`TR_PAGE_STATE` 响应增加 `{ pendingCount, failedCount }` 字段（向后兼容）

## 实施顺序与依赖

| 阶段 | 内容 | 依赖 | 可独立上线 |
|---|---|---|---|
| Phase 1 | scanner：语义排除 + 段落块粒度 + 序列化白名单 | 无 | ✅ |
| Phase 2 | scheduler：状态机 + 超时重试 | 无（与 P1 并行可做） | ✅（部分收益） |
| Phase 3 | Port 传输 + 后台单队列 + 退避 | Phase 2 的状态机 | 与 P2 一起上 |
| Phase 4 | 动态内容增量发现 | Phase 1 的 scanner | ✅ |

建议节奏：**P1 → P2+P3 → P4**。P1 解决用户最直观的"翻按钮"问题；P2+P3 必须一起上（超时重试依赖断线感知才完整）；P4 收尾。

## 风险

- 段落块粒度改变会使**缓存全部失效**（key 里的 html 变了）——一次性成本，可接受。
- 语义排除有误伤可能（如用 `role=button` 的 div 做正文折叠的站点）——scanner 单测样例库要随 bug 报告持续扩充，规则集中在一个文件里便于调整。
- Port 在 MV3 下不能无限延长 SW 寿命（Chrome 116+ 行为），方案不依赖延长寿命，只依赖 `onDisconnect` 的死亡感知 + 重发，这是可靠的。
