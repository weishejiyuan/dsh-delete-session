# 1. 会话永久删除走文件系统，不走会话服务

日期：2026-11-19
状态：已接受

## 背景

需求是给 DSH 桌面端加「永久删除会话」入口。DSH 没有公开的会话删除 API：`ISessions` 接口只有 create / fork / retain / search / refresh，`SessionPersistence` 只有 create / open / flush / stat / list，`ctx.fs` 只有 `deleteFile`（仅删单文件，删目录会抛 `FS_NOT_REGULAR_FILE`）。删除只能落在文件系统上，且 Host 半必须使用真实 Node API `node:fs/promises` 的 `rm(dir, {recursive:true, force:true})`，不能使用 `ctx.fs`。

## 决策

删除会话 = 四步操作，按顺序执行：

0. **活动检查闸门（Q19）**：删除前先询问所有 provider 该会话是否还有运行中的工作——
   ```js
   const activity = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
   if (activity.length > 0) return { ok: false, code: 'SESSION_ACTIVE', message: '会话正在运行，请先停止' }
   ```
   非空则拒绝删除，不碰文件系统。这与官方 `archiveSession` 的行为一致（`dsh-workspace/src/index.ts:389-393`）。
1. **递归删除文件**：Host 半使用 `node:fs/promises`，遍历 `~/.dsh/sessions` 下所有 project 目录，尝试删除 `<project>/<uuid>/` 与 `<project>/session-<uuid>/` 两种命名，`rm -rf` 幂等删除。
2. **清 archive 集合**：Host 半 `inject: ['workspaceRegistry']`，调用 `ctx.workspaceRegistry.unarchiveSession(sessionId)`，把该 id 从 registry-global `archivedSessionIds` 移除。
3. **清 pin 集合**：调用 `ctx.workspaceRegistry.unpinSession(sessionId)`，把该 id 从 registry-global `pinnedSessionIds` 移除。

**全或不全语义（Q2）**：删除视为整体成功或整体失败。所有匹配目录都删除后才返回 `OK`；任一目录删除失败返回 `DELETE_FAILED`，不做部分成功，不把已删除的目录回滚（`rm force:true` 已幂等）。

**不加锁（Q3）**：不在 Host 路由里加 `Set<sessionId>` 去重或锁文件，依赖活动检查闸门 + `rm force:true` 的幂等性和 DSH 持久化层的跨进程写锁进行并发防护。

**不接 `ctx.remoteAccess` 权限门（Q6）**：删除入口对所有能看到会话行的调用方开放，不做 action 级权限判断。

不手工清理 SQLite 查询索引。

## 理由

**为什么必须做活动检查（Q19）**：官方 `archiveSession` 在写归档集合前先走 `workspace/session-activity` waterfall，非空则抛 `WorkspaceActiveSessionError`（`dsh-workspace/src/index.ts:389-393`）。归档只是加一个标记，尚且要拒绝运行中的会话；删除是抹掉整个目录，保护只应更严。绕过这道闸的具体风险场景：会话 A 正在生成回复，用户切到会话 B（A 的 `retainedBy.mainView` 变成 0，删除按钮变可用），用户点删除 → `rm -rf` 正在写入的目录 → 日志损坏或持久化层写锁报错。ADR-0004 的「当前会话」判定无法覆盖这个场景，因为 `mainView` 只表示「显示在主视图」，不表示「没有在跑」。

**为什么不强制停止（否决 Q19-B）**：`workspace/session-stop` 会静默终止用户可能跑了很久的 agent 任务。删除按钮的语义是「删掉这个会话」，不是「终止这个任务」——两件事应该分开。用户若想删运行中的会话，先手动停止，再删。

查询索引是**对账式**的：它比对「SQLite 里有行」与「持久化列表里没有」，差集自动删除（`dsh-session-query-sqlite/src/index.ts:423-425`）。手工清索引是与实现机制对抗——一旦 DSH 改变对账策略或索引结构，手工清理就会变成故障源。让它自己收敛，插件只负责让会话从持久化列表里消失。

archive 集合与 pin 集合不是会话文件的硬链接，但它们会保留已删会话的 id（`dsh-workspace/src/spec.ts:48-49`「archivedSessionIds is the registry-global archive set」）。若留着，侧栏在「仅看已归档」或「置顶」筛选下会尝试渲染一个已经不存在的会话——虽然 `tree.ts` 的可见性判断对 summary 缺失是安全的，但 registry 里留一条永久孤儿 id 不干净。用户要的是「删了就是没了」，不是「删了还留个影子」。

`unarchiveSession` 与 `unpinSession` 都满足三个条件：
1. **公开**：`ctx.workspaceRegistry.unarchiveSession`（`dsh-workspace/src/index.ts:115`）与 `unpinSession`（`:477`）都在 `dsh-workspace/src/index.ts` 暴露
2. **幂等**：id 不在对应集合里时直接 return，删除操作重复调用安全（`:425`, `:485`）
3. **不校验会话存在**：注释明确说「removing an id cannot introduce an unknown one」（`:413-415`, `:469-471`）——所以先删文件再清 registry，顺序无所谓

archive 时 pin 集合会自动清理（`index.ts:399`），但本插件删的是文件、不走 archive 流程，所以 pin 孤儿必须显式清理。

不接权限门的理由：桌面单用户场景下，能看到会话行的人就是 owner（`OWNER_BASELINE` 全放行），接权限门是零收益的复杂度。将来若支持多 peer，再补 `ctx.remoteAccess` 也不迟——那时删掉 `resolve` 里的一层判断即可。

## 后果

- 删除顺序：先活动检查，再 `rm -rf` 会话目录，最后 `unarchiveSession` + `unpinSession`。
- 运行中的会话无法删除，用户需先手动停止任务。这是刻意的保护，不是缺陷。
- `SESSION_ACTIVE` 是新增的失败 code，与 `SESSION_NOT_FOUND`、`DELETE_FAILED` 并列。
- `workspace/session-unarchiving` 事件会 dispatch。本机 profile 唯一可能的监听者是 `dsh-experimental-worktree`，它未安装；即便装了，该监听器对「无 attempt 的 session」也是幂等无操作（`archive.ts:88-92`）。
- `unarchiveSession` 和 `unpinSession` 的写操作在 registry 的串行队列里执行，不会和并发 archive/pin 竞态。
- 不接权限门意味着：将来若某个 peer 对「会话可见」但「不应可删」，本插件拦不住。这是接受的取舍。
- 若将来 DSH 提供公开 delete API，应改用它——那时本 ADR 可被取代。

## 已闭项：workspace `sessionIds` 孤儿

**决策：不处理。** `archivedSessionIds` 与 `pinnedSessionIds` 是 registry-global 叠加在 workspace accounting 之上的集合，本插件负责清这两个。workspace 自己的 `sessionIds` 数组是否还持有该 id，属于 workspace 级记录，不是会话级记录。`dsh-workspace/src/index.ts:631-635` 已有「workspace record deletion and registry-order rollback」容错逻辑，孤儿 id 不影响会话列表渲染。若将来 DSH 提供 workspace 级 session 清理 API，再作为独立 ADR 评估。
## 修订 2026-11-19（实现期，决策 A）

**被推翻的前提**：上文第 1 步「遍历 sessions 根下所有 project 目录 × 两种历史命名（`<project>/<uuid>/` 与 `<project>/session-<uuid>/`）」不成立。事实：sessionId 自身带 `session-` 前缀（`dsh-api-session-controller/src/agent.ts:433`），目录名由 `encodeSegment(sessionId)` 得出（`dsh-session-persistence-jsonl/src/format.ts:267-269`），永远只有一个形态；本机实测同样只有 `session-<uuid>`。第二种命名是 no-op。

**改为**：

- **定位**用 `ctx.sessionPersistence.stat(sessionId)`：`snapshot.location.path` 是日志绝对路径，`dirname` 即会话目录；返回 `undefined`，或快照无 `location`（未落盘的 pending 会话）→ `SESSION_NOT_FOUND`。理由：官方 `stat` 内部本来就在遍历所有 project 目录，并附带 legacy 布局处理与重复 id 检测（`dsh-session-persistence-jsonl/src/index.ts:483-526` 与 `:1575-1589`），手写版本必然更差。
- **inject** 增加 `sessionPersistence`：`['webServer', 'connection', 'workspaceRegistry', 'sessionPersistence']`。
- **sessions 根改作围栏**：`path.relative(root, dir)` 判定目标是否在根内（Windows 大小写不敏感；`step === ''` 表示目标就是根本身，同样拒绝）；越界 → `DELETE_FAILED`，不删。
- **默认根不 import `dsh-home-paths`**：插件测试跑在裸 Node 环境，该包只在安装树里可解析。改为等价实现官方优先级——显式配置 > `$DSH_HOME`（空白视为未设）> `~/.dsh`，再拼 `sessions`（对照 `dsh-home-paths/src/index.ts:126-137`）。

**接受的代价**：若有人用 patch 把持久化层的 `root` 改到默认路径之外，围栏会拒绝合法删除（安全失败、不丢数据），此时需配 `sessionsRoot`。

**其余不变**：活动检查仍在任何文件操作之前；全或不全；不加锁；不接权限门；不手工清索引。
