# 术语表

本文件只定义领域术语。实现细节、决策与计划不属于这里。

## Profile bundle

安装到 `~/.dsh/profiles/<profile>/node_modules/`、在 profile 的 `package.json` 里由 `dsh.profile.bundles` 列出的 npm 包。它的 Host 半由 Cordis Loader 直接 `import`，运行在真实 Node 环境；Client 半由浏览器加载。

**避免**：把「bundle」当作「动态包」的同义词。两者是 DSH 里两条不同的执行路径。

## 动态包

由 `cordis.define()` 在运行时定义、重启即消失的插件。它的 Host 半跑在 `node:vm` 沙箱（无 `require`/`import`/`fetch`/`setTimeout`），Client 半跑在受限沙箱（无 JSX/import/DOM，只有 `React`/`console`/`styles`/`host`）。

**避免**：不要用动态包的限制去推断 profile bundle 的能力，反之亦然。

## 组合包

见 **Profile bundle**。`package.json` 的 `dsh.profile.bundles` 数组里的一项就是一个组合包。

## Host 半

插件的 Node 侧入口（profile bundle 的 `index.js`）。由 Loader import，有完整 Node API，可注册命令、工具、HTTP 路由。

## Client 半

插件的浏览器侧入口（profile bundle 的 `client/client.js`）。注册 UI 用 `ctx.slots`，调 Host 用 `fetch` 打 `ctx.webServer` 注册的 HTTP 路由。

**避免**：把 Client 半说成「沙箱」。沙箱是动态包才有的约束。

## `harness.handle`

动态包的 Host 半注册 RPC 方法的动词；对应 Client 半的 `host.call`。

**避免**：在 profile bundle 里使用。Profile bundle 的 Client 半无法触及 `harness`，因为浏览器里根本没有这个对象。

## 会话

DSH 的一次对话。一个会话对应一份持久化日志（`~/.dsh/sessions/<project>/<uuid>/session.v4.jsonl.zstd`）与一条查询索引记录。

## 会话目录

会话日志所在的目录：`<project>/<uuid>/`。旧格式为 `<project>/session-<uuid>/`，两者可能在同一 project 下并存。

## Project 目录

`~/.dsh/sessions/` 下按工作目录转义而来的目录名。非 ASCII 字符编码为 `~XXXX~`，盘符与路径分隔符转成 `-`，首尾加 `--`。

## 会话索引

`dsh-session-query-sqlite` 维护的 SQLite 投影，供全文搜索。它是**对账式**的：索引里有行但持久化列表里查不到该会话时，下一次对账自动删除该行。

**避免**：把索引说成需要手工同步的缓存。

## mainView 引用计数

会话列表快照里 `retainedBy.mainView` 的值。大于 0 表示该会话是主视图当前展示的那个——这是 DSH 判定「当前会话」的依据，不是「选中」，也不是 `activePanelId`。

## Registry-global 集合

`workspaceRegistry` 里两个跨 workspace 的全局集合：`archivedSessionIds` 与 `pinnedSessionIds`。它们叠加在 workspace 各自的 `sessionIds` 之上，用于全局归档/置顶。archive 时 pin 集合自动清理，但删除文件不走 archive 流程，两个集合的孤儿都要显式清理。

## RemoteAccess 权限门

`ctx.remoteAccess.source(kind, id, action)` 返回 `Observable<boolean>`，用于判断当前调用方能否对某资源执行某动作。官方 `workspace/delete`、`workspace/archiveSession` 等菜单项用它决定是否显示。本插件不接此门——桌面单用户场景下 owner 全放行，接权限门是零收益复杂度。

## Slot

Client 侧 UI 注册表里的一个位置。插件用 `ctx.slots.register({name, id, order, ...}, Component)` 往已有 slot 追加组件。`kind: 'list'` 的 slot 允许多个注册者按 order 共存。

## 会话行内按钮区

`sidebar.workspaces.session.row.action` slot，渲染在会话行右侧的 hover 按钮条里。官方占用了 archive(100) 与 pin(200)。行内还有一个官方内联渲染的 `⋯` 更多菜单按钮，不通过 slot 注册，不受 order 控制。

## Shell overlay

`shell.overlay` slot，全窗口浮层容器。对话框、toast 这类必须比行菜单活得更久的 UI 注册在这里。

## 图标 key `session.delete`

右键菜单「永久删除」项注册到 `contextMenu.icon` slot 的 key。图标组件复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `IconTrashOutlineRegular`。

**避免**：不要自定义图标 key，避免与官方 `workspace.archive`、`workspace.unarchive` 等 key 冲突。

## Locale namespace `deleteSession`

插件自有的 locale 命名空间，通过 `ctx.locale.register('deleteSession', {zh, en})` 注册，`ctx.locale.bind('deleteSession')` 绑定。只覆盖 zh+en，其余 locale 不单独翻译。

**避免**：不要把 namespace 起成 `session.delete` 或 `delete-session`，与图标 key 区分开，避免混淆。

## 永久删除

不可逆的会话删除操作。删除后会话目录被递归删除，workspace registry 的 archive 与 pin 集合中对应的 id 被移除，SQLite 查询索引通过对账机制自动收敛。不提供撤销窗口，删除后不自动切换会话。运行中的会话拒绝永久删除。

## 运行中会话

仍有未停止工作的会话。有**两层**判定，宽窄不同：

- **客户端窄判定**：`SessionSummary.running === true`，只覆盖「有轮次在跑」。用于按钮层提前置灰，不发请求。
- **服务端权威判定**：`ctx.waterfall('workspace/session-activity', {sessionId}, ...)` 返回非空。覆盖正在生成的回复、子 agent、后台 job、活动 schedule。

**避免**：把「运行中」等同于「当前会话」。当前会话只是「正显示在主视图」，用户可以切走而让它继续运行；反过来，非当前会话完全可能在跑长任务。两者是不同维度，`mainView` 判定不能替代活动检查。也不要用客户端 `running` 替代服务端 waterfall——前者窄，后者才是权威。

## 空白会话行

尚未发送任何消息、还没有落盘会话目录的 provisional 行。DSH 用它作为「新会话」的入口。删除对它是无意义的：没有目录可删，只会得到 `SESSION_NOT_FOUND`。因此删除入口在空白行上不显示。

**避免**：把空白行当成普通会话处理——它不是任何会话文件，只是一个待填的草稿位。
