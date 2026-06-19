# Yoda 开发日记（第一人称 · 导演剪辑版）

> 从接手 emdash 到 v0.13.4 —— 那些 CHANGELOG 不会告诉你的反复、死胡同和翻盘
> 2026-05-10 ~ 2026-06-19

---

## 写在前面

上一版日记是「发生了什么」。这一版是「**当时我在跟什么较劲**」——把 1029 个 commit 的 message body 翻了个底朝天，挑出那些做了又删、删了又改、自己钦定终版又当场推翻的痕迹。

如果要用三句话概括这 40 天的「性格」：

1. **「Agent 到底是什么」这个问题，我从头到尾没想清楚过**——runtime 还是 agent、slot 选裸 runtime 还是只选 Agent、最后干脆「所有 LLM 调用都是 Agent」。同一个概念推翻重建了至少四回。
2. **我埋的抽象会反咬我**——顶部 tab 的「scope-entry 信号」、僵尸 working 的「self-heal」、团队引擎的「确定性状态机」，每一个都是我自己设计的机制，每一个都回头把我绊倒，逼我从「打补丁」升级到「让 bug 在结构上无法存在」。
3. **细节强迫症能烧掉一整天**——一个开机画面的闪烁光标、一个分支后缀标签的字号，我能精确到 0.5px 地反复横跳。

下面按时间线，挑最有戏的讲。

---

## 第一章 · 断奶（5/10 – 6/4）

### 5/10：改名这一刀，我砍得很绝

接手第一天，我没写功能，我在改名。`emdash → yoda`，而且是 **clean break**——`EMDASH_*` 环境变量直接换 `YODA_*`，不留 fallback。登录更狠：上游用 PKCE-loopback 打 `auth.emdash.sh`，Lovstudio 这边压根没有对应物，我直接 *"Drop PKCE-loopback against auth.emdash.sh (no Lovstudio equivalent existed)"*，换成自家设备流。

### 5/11：第一次签名，是「签不了就降级」换来的

CHANGELOG 写的是「第一次完整 Apple 签名+公证跑通」。真相是：密钥还没配齐，我先被迫把签名做成可选的——*"gate Azure/R2/Apple steps on secret presence; add GitHub Release upload as fallback"*。也就是说「第一次签名成功」之前，先有一轮「签不了也得能发版」的妥协兜底。

同一天还闹了个笑话：那个「斯多葛风格尤达脸」的 SVG，文件名昨天改了，**内容里还写着 EMDASH**——*"the file was renamed in 0b075bb1 but contents still spelled EMDASH"*。改名这事，比想象的藏得深。

### 断奶花了快一个月

5/10 我写了「自动迁移 Emdash 旧数据目录」的逻辑。6/4，我把它**主动删了**——明确「Yoda 是独立项目，Emdash 只留作上游致谢」。从改名到删迁移，断奶用了 25 天。

> **反馈出口一个月跳了三次**：5/12 从 Discord webhook 改走自家后端 → 6/8 又把自家后端 RPC 和附件上传整套删掉，改成直接预填打开 GitHub issue。我自己都没想好用户该往哪反馈。

---

## 第二章 · 蛰伏期的硬骨头（5/21 – 6/9）

提交量低，但全在啃地基。几条值得记的：

**「projectless」做了一周就被我整个推倒。** 5/25 我加了「无项目会话」一整套（controller / view / store / sidebar item / shared 常量）。6/2，全删，合并进 task pipeline 用内置 Drafts 项目顶替。功能没错，是架构错了。

**终端排版错乱，根因藏在「off-screen 时按 120 列写死」**（5/26 e51710b1）：历史 buffer 在终端还是默认 120×32 且不可见时就被写进去，*"scrollback 按 120 列 wrap 后无法 unwrap，直到用户拖动 resize handle 触发 cols 变化时 xterm 才 reflow"*。修法是加 pendingWrites 缓冲，等真实尺寸到位再 flush。

**纯中文 prompt 不触发转圈**（5/12 299a85f1）：根因是 `HAS_ALPHA` 正则写成 `/[A-Za-z]/` 只匹配 ASCII。中文走 Enter 提交时判定不了「有内容」。改成 `\p{L}`。——这种「名单只列了 ASCII」的坑，后面还会再踩（顿号变 `\`，是键名单漏了美式键盘的 Backslash）。

**「Agent 是什么」第一次大纠结**（6/8–6/9 三连）：
- 先把「Agent Runtime（执行环境）」和「Agent（prompt+skills）」拆开建表；
- 做了个统一 slot picker，允许「选 Agent 或选裸 runtime」并列；
- 当场自我否定——*"The previous picker wrongly listed bare runtimes as peers of Agents, collapsing the entity into one of its own fields."* 改回只能选 Agent，runtime 降级为可覆盖字段。

期间 agent-slot 选择器还**连续两次被我「先撤掉」**（WIP 没做完，先把散落 import 删了让树能编译）。最后落在一个干净抽象上（6/9 ba66f6d9）：*"Every LLM call the app makes is now an Agent."* ——绕了一大圈才想明白。

**最难缠的「转圈不准」**（6/9 2e4d6238）：我决定不再靠「2.5s 文本启发式」猜状态，改成**确定性状态源**——直接 tail Codex 自己写的 rollout JSONL，把散落的 5 个状态写入源收敛成单一权威 reducer，还加了「running 超 30 分钟无 transition 强制 idle」的看门狗。这个决策在后面 team-room 时代会被反复验证、又反复挑战。

---

## 第三章 · 大爆发：被自己的抽象反咬的三天（6/10 – 6/13）

三天 ~508 个 commit，6/12 单日 229。这三天的剧本几乎一模一样：**上午落地大重构，下午到深夜被它反咬，连环修。**

### 剧目一：顶部 tab「点了没反应」四连环（6/10–6/11）

我上午落地了「顶级作用域 tab 体系」大重构——tab 是可序列化 route、按作用域过滤、切任务整组切。这是后面所有麻烦的源头，因为我埋了一个抽象：**「tab-less 路由 = scope-entry 信号」**。然后它绊了我四次：

1. 点 task **总弹回概览页**，而且*"越用越严重"*——因为每次误激活 Overview 还会抬高它的 seq，污染 scope 记忆。（自我恶化型 bug）
2. **关闭按钮失效，同帧被自己复活**——*"关闭后路由回落到 tab-less 的 index tab，TopLevelTabSync 将其判定为 scope entry，还原'上次活跃 tab'——正是刚关掉的那个，于是同帧原样重建。"*
3. 概览 tab 点击无响应，同一个根因换了个地方。这次我终于上系统方案 `normalizeTabParams`，四个写入点统一归一化。
4. 隔天 project tab **重蹈覆辙**——*"与昨天修复的 task tab 同类问题，当时漏了 project tab。"* 还顺带挖出 MobX 机制：*"路由同步 reaction 不收敛，MobX 100 次迭代后丢弃 pending observer，store 已切视图但 UI 冻结。"*

最后我没再打补丁，而是**推翻物化策略本身**（7da6e1e2f）：*"删除 _ensureScopeIndexTab：固定页签不再物化进 tabs[]"*，改为实时合成 `visibleTabs`，*"残缺状态在结构上不可能出现。"* ——这是这三天我学到的最值钱的一课：别修症状，让症状没有存在的余地。

### 剧目二：僵尸 working 被 self-heal 反咬（6/10）

我做打断按钮时已经预判了一个陷阱，**刻意不做乐观更新**——*"renderer 来源的 idle 回声不会被 main 重新广播，会把全局运行态镜像永久钉在 working。"* 结果还是翻车了：打断后强制清的 idle，被 `deriveStatus` 的 self-heal 立刻覆盖回 working 并广播——*"冻结在 turn 中途的 transcript 永远判 working。"* 我引入内存态 interrupt-marker 压住它，并诚实地写下它的不完美：*"标记仅内存态，app 重启后僵尸短暂回归，再点一次即压住。"*

同一天还发现归档会在热更新时丢失，根因写得极坦诚——*"归档此前是 renderer 内存中的多步 saga，dev 热更新的 full reload 会清空在途 await 链，归档 SQL 永远不会发出，任务'复活'。"* 这直接推动了「归档编排下沉主进程」。

### 剧目三：终端 resize，一篇硬核 postmortem（6/10 1ba897ddd）

一次重构干掉「白闪/跳动/橡皮筋」三个症状，每个都点名根因：
- 橡皮筋感：*"快拖时主线程被 10-25ms/次的提交饿死。"*
- 抖动：*"panel group 百分比量化会抖 ±2px/帧"* → 退出 panel group 改纯 flexbox。
- 顺手删死代码：*"删除 panelDragStore 全链路（drag 门控已被事件驱动取代）。"*

### 剧目四：开机画面的强迫症长征（6/12–6/13）

这条线本身就能写一篇文章。一个闪烁光标，烧掉我一整天：

- 光标闪到全透明，把字标右边缘**顶得每次都跳一下** → 留 0.22 透明度的 ghost 稳住对齐；
- 嫌实心 ghost 太重 → 改 1px 空心描边；
- 描边颜色**当场反悔**：mint 换 muted white，下一个 commit 直接 `revert cursor outline back to mint`。一加一删，净改动为零。

然后是进度条和退场门的反复：
- 抓出首屏卡 4 秒真凶——`execSync` 在第一个 await 前同步跑 `$SHELL -ilc env`，*"whenReady → createMainWindow 4055ms，其中 resolveUserEnv 同步段占 3865ms"*；
- 主窗口创建即 `show()`，用静态 splash 盖住加载段；嫌第一眼是光标不是品牌 → 换成兜帽 logo；
- 加「苹果式进度条」并**移除手动确认门**（自动淡出）→ 发现两根进度条重复，删一根 → **退场方式 180 度转回去**：自动淡出又改回手动门。

> 自动退场：加了又撤、撤了又恢复。光一个开机画面的退场逻辑，我在一天里反转了两次。（这跟记忆里「退场=手动确认门，历史两度反转」完全对上了。）

### 剧目五：登录 shell 喷横幅，污染 PATH（6/13 add9be236）

教科书级根因：`$SHELL -ilc 'env'` 的 `-i` 会触发 *"powerlevel10k instant prompt / oh-my-zsh banner / 版本管理器横幅往 stdout 喷字符"*，混进 env 输出把 PATH 解析坏了，*"GUI 启动后 claude/tmux 检测不到（即便用户 PATH 写在 .zshrc）"*。对齐 VS Code 用哨兵 `__YODA_ENV_START/END__` 包裹。这个 fix 重要到我专门 re-cut 一版。——只有真用 zsh + p10k 的人才会踩到的坑。

### 剧目六：自动更新，我们一直在裸奔（6/12–6/13 三连）

三个独立竞态，凑成一句话「自动更新这件事我一直没真正跑通过」：
- 差分下载从来没生效，每次更新全量拉 ~280MB；
- mac 用户在窗口期内更新**必 404**——*"latest/download 指向了 mac job 上传前 ~15 分钟，每次 mac 检查都 404"* → 改先发 draft、三平台传齐再 flip live；
- 一整批老用户**从来没法自动更新过**——*"legacy feed releases.lovstudio.ai 从不存在（R2 secrets 没配、域名 NXDOMAIN）"* → 用 Vercel 302 救活。

### 剧目七：标签拖拽，「钦定终版」当场被推翻（6/13）

跨区域拖回 tab 要不要激活，这个语义我改了至少五版：
1. 先推翻底层——*"HTML5 DnD 在 macOS frameless 窗口里不可靠（CDP 实测合成事件全通、真实拖拽无效）"* → 换指针驱动；
2. drop 一律不激活；
3. 反转：落点决定激活；
4. 再反转：拖回主窗口一律激活；
5. **「用户钦定终版」：drop 永不激活，看不见弹 toast** ——四个字「钦定终版」之后，下一个 commit 立刻推翻它，改成浏览器式 sticky tab。

### 那一分钟的版本号横跳

6/12 19:09 发 v0.11.0，**19:10（一分钟后）**re-cut 成 v0.10.1——*"品牌对齐+导航整理更适合 patch"*。这跟记忆里「feat≠minor」的信条对上了：功能多不等于够格 minor。（这个拉扯到 6/14 还会再演一次：90 秒内 v0.11.2 → v0.12.0 → 又退回 v0.11.2。）

---

## 第四章 · 收敛期：团队引擎的「通用 vs 能跑」之争（6/14 – 6/19）

这五天主线是把零散能力拢成「多智能体协作」。最有戏的是**智能体团队引擎在五天里换了三种架构**，以及 Review 工作流被一连串「假成功」逐个绞杀。

### Review 的「假 PASS」系列

每一个都是 PTY-marker 抓取范式的固有脆弱性：
- **假 PASS（最经典）**：prompt 里写了字面 marker，被回显进 buffer，解析取了第一个匹配——*"matched the echoed prompt's PASS on the first poll，秒过、reviewer 根本没审"*。修法：prompt 改成不可匹配的占位符 + 取**最后一个**匹配。
- **陈旧 marker**：跨轮复用同一评审会话后，buffer 里留着上一轮的 marker → 引入 `markerCount` 基线。
- **注入发不出去**：*"submit delay 对 Claude 是 0，12k 字符的大段反馈还没贴完，Enter 就抢跑，prompt 留在输入框没发出去，编排器却已经以为对方在工作、往下走了。"* → 地板 300ms。
- **空白评审面板**：评审会话是主进程建的，渲染层没桥接 → 开 tab 前先 `ensureConversation()`。

### 团队引擎：三次推倒重来

这是整段最有戏的部分，本质是「为了通用 vs 为了能跑」拉锯：

1. **第一版 marker scraping**：conductor 等 agent 输出里的 `<<<YODA_TEAM_MSG>>>` 块。
2. **第二版 game-loop + 脚本回调**：抓标记翻车——*"caused the reviewer to never trigger, and looked ugly"* → 改成 @ 直接注入对方 session，agent 跑 `.yoda/team-at` 脚本回调，*"conductor is a state machine, not a scraper."*
   - 期间踩到**系统行重入路由 → 死循环+崩溃**：*"conductor 自己的系统行（裁判转场、standup）是无作者的，被当成真人 prompt，重新触发裁判自启，又发一条系统行，无限循环。"*
   - 还踩到**claude 的 Bash 工具拿不到 `YODA_PTY_ID`**（codex 能、claude 不能）——*"sanitized shell 不继承，且 set -u 下诊断自己抛 'unbound variable'。"* 最后干脆**不靠 env**：把 ptyId 字面烤进每个成员自己的脚本。
3. **ACP 结构化 hook 取代 PTY-marker**（关键决策）——*"This is the structured agent-comms answer: extend our hook-based ACP with explicit verbs, rather than A2A (wrong layer for local CLIs) or JSON-in-PTY (re-introduces fragile scraping)."* 这是对前面所有「假成功」的根治：*"a finished reviewer that never emitted a clean marker is no longer defaulted to FAIL."*
4. **第三版 Leader 编排，再删掉一切确定性**（6/17）：用户钦定「每个团队预设一个裁判/Leader Agent（创业公司=CEO），由它用 prompt 智能编排」。然后再推一次，**完全 prompt 驱动，删掉所有确定性状态机**——并诚实写下取舍：*"取舍:失去确定性 PASS/FAIL、轮次上限、codex stall 兜底,换取架构纯通用。"*

> 五天换三种架构，最后我**亲手删掉自己两天前刚做的 team-verdict 脚本/hook**。独立的 review run mode 被刻意保住不受影响——这是「通用范式」和「能用功能」的分治。

### 一个回报：复用铁律的红利

术语翻转 Runtime→客户端 / Agent→智能体 时，我写下一句很爽的话（3c84a20e4）：*"Agent 组件已被 normal/brainstorm/compare/review/team 全部范式复用，故团队等「多智能体」章节自动获得一致的卡片体验。"* ——前面在「同实体跨 surface 必须一致」上的投入，这里自动兑现。

### 收尾的小翻转

- 开机确认门改成**只第一次卡**——*"the confirm beat is first-run flavor, not a tax on every open."*（这是退场门的又一次反转，记忆里记的「两度反转」其实只是冰山一角）。
- 更新器静默吞错（6/18）——*"国内网络下更新器子进程不走系统代理,feed 能读到但 GitHub 二进制下载必失败,旧 UI 把失败静默吞掉。"* 加 toast + 手动下载兜底 + 代理覆盖。（跟全局「ClashX 7890」规则、记忆里 updater-feed-landscape 完全呼应。）
- 还有十几条非代码 commit 在反复打磨 PR 宣言，对标孙中山讲稿，删掉「绝地大师」等隐喻，最后落在尤达谐音梗：**「路虽远，行则尤达」**。

---

## 尾声 · 这 40 天教会我的三件事

1. **别修症状，让症状无法存在**。顶部 tab 修了四次补丁，最后靠「固定页签不物化进数组、实时合成」才真正终结——*"残缺状态在结构上不可能出现"*。
2. **我设计的每个「聪明机制」都会回头咬我**。self-heal、scope-entry 信号、确定性状态机——它们解决了一个问题，又制造了一个更隐蔽的问题。诚实记录它们的不完美（「重启后僵尸短暂回归，再点一次压住」）比假装完美更有用。
3. **「通用」和「能跑」是要分治的**。团队引擎追求纯 prompt 驱动的通用性，就得放弃确定性兜底；那就把「能跑的 review」单独保住，不让通用化拖垮它。

CHANGELOG 记录的是我交付了什么；这份日记记录的是我**怎么把每件事返工到能交付**。后者才是这 40 天真正的样子。

---

*生成于 2026-06-19 · 素材来源：1029 个 commit 的完整 message body，由四个并行 agent 精读提取，所有引号内为 commit body 原文片段*
