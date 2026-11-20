# 0. 命名与规范表（单一真理来源）

日期：2026-11-19
状态：已接受

本文件记录 `@local/dsh-delete-session` 插件的所有命名与规范决策，与 ADR-0001–0006 配套。代码实现时直接套用，不重复造轮子。

## 包与 Loader 行

| 项 | 值 | 说明 |
|---|---|---|
| 包名 | `@local/dsh-delete-session` | 与 `@local/dsh-clear-command` 风格对齐，带 `dsh-` 前缀表身份 |
| `dsh.bundle.patch` | `"./cordis.patch.yml"` | **必须有**：不声明则装了也只是普通依赖，不成为 profile 层 |
| 版本 | `1.0.0` | 首版 |
| Host 行 id | `delete-session-host` | `cordis.patch.yml` 里插入的一行 |
| Client 半 | 靠 `package.json` `dsh.client` 自动发现 | **不在** `cordis.patch.yml` 里单独插行 |
| patch 插入行数 | 1 行（仅 Host） | `dsh-client-modules` 扫描 `dsh.client` 字段自动加载 Client |

## 路由与通信

| 项 | 值 | 说明 |
|---|---|---|
| 路由前缀 | `/delete-session/api` | `ctx.webServer.register({kind:'prefix', path:...})` |
| 方法 | `POST /delete-session/api/delete` | 单 method，无版本前缀 |
| 请求体 | `{ sessionId: string }` | Client 半 POST 发送 |
| 成功响应 | `{ ok: true, code: 'OK' }` | JSON |
| 失败响应 | `{ ok: false, code: 'SESSION_ACTIVE' \| 'SESSION_NOT_FOUND' \| 'DELETE_FAILED', message?: string }` | JSON |
| 守卫失败响应 | `METHOD_NOT_ALLOWED`(405) / `REJECTED`(请求拒绝返回的 401·403) / `NOT_FOUND`(404) / `INVALID_SESSION_ID`(400) | 进业务逻辑之前的四道守卫，按此顺序判定 |
| 活动检查 | 删除前 `ctx.waterfall('workspace/session-activity', {sessionId}, () => Promise.resolve([]))`，非空返回 `SESSION_ACTIVE` | 与官方 archiveSession 一致 |
| 鉴权 fence | `ctx.connection.requestRejection(req) === void 0` | 受信 Host/Origin + 已认证凭据，不接 `ctx.remoteAccess` |
| 配置 | `Config = z.object({ sessionsRoot: z.string() })`（`@deepseek-ai/schemastery`） | 可选；不配时按 `$DSH_HOME` → `~/.dsh` 再拼 `sessions` |

## Workspace registry 清理

| 项 | 值 | 说明 |
|---|---|---|
| inject 依赖 | `['webServer', 'connection', 'workspaceRegistry', 'sessionPersistence']` | Host 半 |
| 会话定位 | `ctx.sessionPersistence.stat(sessionId)` → `dirname(snapshot.location.path)`；`undefined` 或无 `location` → `SESSION_NOT_FOUND` | 见 ADR-0001「修订」节，取代手写目录遍历 |
| 围栏 | 目标目录必须位于 `resolveSessionsRoot(config)` 之内，越界返回 `DELETE_FAILED` 且不删 | 唯一不可逆风险的兜底 |
| 清 archive | `ctx.workspaceRegistry.unarchiveSession(sessionId)`（`Promise<void>`，必须 await） | 幂等，不校验会话存在 |
| 清 pin | `ctx.workspaceRegistry.unpinSession(sessionId)`（同上） | 幂等，不校验会话存在 |
| 执行顺序 | 活动检查 → stat 定位 → 围栏 → `rm -rf` 文件 → 清 archive → 清 pin | 活动检查非空则中止，不碰文件系统 |
| 全或不全语义 | 所有步骤成功才返回 OK；任一失败返回 DELETE_FAILED | 不做部分成功，不回滚已删内容 |
| 并发防护 | 不加锁，依赖活动检查闸门 + `rm force:true` 幂等性 + DSH 持久化层写锁 | — |

## Client 半 package.json 字段（P1-1）

`dsh.client.inject` 是**包名依赖边**（factory 到达顺序 + Cordis 插件组合），不是 cordis service 名。Client 半代码里等待 service 用 `ctx.inject(["serviceName"], cb)`，与这个字段无关。来源：`dsh-client-modules/src/client/manifest.ts:47-50`。

| 字段 | 值 | 说明 |
|---|---|---|
| `dsh.client.platform` | `"web"` | 标记该包的 Client 半在浏览器端运行 |
| `dsh.client.inject` | `["@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-conversation", "@deepseek-ai/dsh-client-ui-sidebar-right", "@deepseek-ai/dsh-client-modules"]` | 照抄 `dsh-better-sidebar/package.json:44-52` 的 5 个包，不加不减。本插件实际只用 locale + slots，但依赖图保持一致降低风险 |
| `peerDependencies["@deepseek-ai/dsh-client-ui-primitives"]` | `"^0.2.2-rc.2"` | `IconTrashOutlineRegular` 走 peerDependencies，不进 `dsh.client.inject`——这是 better-sidebar 的真实做法（`package.json:85`） |
| `exports["./client"]` | `"./client/client.js"` | Client 半入口，`dsh-client-modules` 会自动发现并加载 |
| `icon` | `"./icon.svg"` | Plugin Manager 卡片图标 |
| `files` | 包含 `index.js`, `client/client.js`, `icon.svg`, `cordis.patch.yml` | 需随包发布的文件。**不含 `locale/`**——字符串内联在 client.js 里 |

## cordis.patch.yml 完整示例（P1-2）

```yaml
# 只插入一行——Client 半由 dsh-client-modules 自动发现
- insert:
    - id: delete-session-host
      name: '@local/dsh-delete-session'
```

## locale 字符串（内联）

**不建 `locale/*.json` 文件**。字符串直接内联在 `client/client.js` 里，单一真理来源，避免两份副本发散。

**注册签名**：一次调用传 dicts 对象——`ctx.locale.register('deleteSession', { zh: {...}, en: {...} })`。来源：`dsh-client-locale/src/client/index.ts:404` 的重载 `register(ns, localeOrDicts, dict?)`，官方内部就用这个形式（`:586-587`）。

| key | zh | en | 用途 |
|---|---|---|---|
| `label.deletePermanently` | 永久删除 | Delete permanently | 右键菜单项文案、行内按钮 aria-label 与 Tooltip |
| `confirm.title` | 永久删除会话 | Delete session permanently | 确认框标题 |
| `confirm.desc` | 将永久删除「{title}」，此操作不可撤销。 | "「{title}」 will be deleted permanently. This cannot be undone." | 确认框描述，含会话标题占位 |
| `confirm.action` | 永久删除 | Delete permanently | 确认框右侧按钮 |
| `confirm.pending` | 正在删除… | Deleting… | 请求进行中的状态行 |
| `cancel` | 取消 | Cancel | 确认框左侧按钮 |
| `close` | 关闭 | Close | `Modal` 的 `closeLabel`（关闭按钮文案），缺失时会回落成键名 |
| `deleted` | 会话已永久删除 | Session deleted permanently | 成功 toast |
| `sessionActive` | 会话正在运行，请先停止 | Session is running; stop it first | `SESSION_ACTIVE` toast |
| `sessionNotFound` | 会话不存在，可能已被删除 | Session not found; it may already be deleted | `SESSION_NOT_FOUND` toast |
| `deleteFailed` | 删除失败 | Delete failed | `DELETE_FAILED` toast 前缀，后接具体原因 |

key 命名约定：`label.*` 供菜单/按钮，`confirm.*` 供确认框，其余为顶层 key。与图标 key `session.delete` 彻底分开。

## 静态资源（P1-4）

| 项 | 值 | 说明 |
|---|---|---|
| 图标文件 | `icon.svg` | 放在包根目录，复用官方 trash 图标语义 |
| `package.json.icon` | `"./icon.svg"` | Plugin Manager 卡片显示 |
| `package.json.files` | 需包含 `icon.svg` | 随包一起发布 |

## 代码导出约定（P1-5）

**Host 半是普通 ESM**（真实 Node 环境，Loader 直接 import）：

```js
export const name = 'delete-session-host'
export const inject = ['webServer', 'connection', 'workspaceRegistry']
export function apply(ctx) { ... }
```

**Client 半不是 ESM，是 classic script + 工厂包**。浏览器侧模块系统要求 bundle 在被加载时就调用 `window.__ModuleLoader__.load({id, factory})` 注册工厂，依赖通过 `require()` 注入。

来源（三条，均为事实）：
- `dsh-client-modules/src/client/system.ts:209-224`：bundle 作为 classic script 加载后必须已注册 `factories`，否则报 `loaded without registering "<id>" via __ModuleLoader__.load`
- `dsh-client-modules/src/client/system.ts:313`：`registered.factory(this.makeRequire(ownerId, edges))` — 工厂收到同步 `require`
- `dsh-better-sidebar/lib/client.js:1-35` 的实际形态

正确形态：

```js
window.__ModuleLoader__.load({
  id: '@local/dsh-delete-session',   // 必须等于 package name
  factory: (require) => {
    const React = require('react')
    const { Button, IconTrashOutlineRegular, Modal, Tooltip } = require('@deepseek-ai/dsh-client-ui-primitives')
    return {
      name: 'delete-session-client',
      inject: ['slots', 'locale', 'contextMenus'],
      apply(ctx) { /* ... */ },
    }
  },
})
```

**可 `require` 的范围**：平台 seed word（`react`、`react-dom`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives` 等，由 web shell 内置，不在 node_modules 里）+ 已在 `dsh.client.inject` 列出并已注册的包行。其他 specifier 会抛 `cannot resolve "<specifier>" — not a seed word, not a materialized module`（`system.ts:384-392`）。

## UI 组件 props 约定（P1-6）

| 组件 | props | 说明 |
|---|---|---|
| 行内按钮 | `{ sessionId: string, displayTitle: string }` | 来自 `SessionRowOwnerProps`（`dsh-client-ui-workspace/src/client/contract/slots.ts:93-99`）：`sessionId` 会话 id，`displayTitle` 行显示标题（持久化标题，无标题时为空串） |
| 右键菜单 target | `{ sessionId: string }` | `run` 回调里通过 `target.sessionId` 获取会话 id |
| 确认框 | `PropsRuntime<'shell.overlay'> & PropsLocale<'deleteSession'> & PropsHooks<{ target, clear }>` | 照官方 `SessionArchiveConfirmProps` 形状（`slots.ts:510-515`）：`PropsRuntime` 提供 slot 运行时，`PropsLocale` 提供 `t()`，`PropsHooks` 注入自定义 hooks |

**shell.overlay props 依据**：官方所有 overlay 条目都走 `PropsRuntime<'shell.overlay'> & PropsLocale<NS> & Omit<Injected,'hooks'> & PropsHooks<Injected['hooks']>` 三段式（`slots.ts:503-519`）。本插件沿用同一形状，只是 `NS` 为 `deleteSession`、`Injected['hooks']` 为 `{ target, clear }`。

## UI 入口

> **重要说明**：`order: 300` 是「slot 注册顺序」——在 `sidebar.workspaces.session.row.action` slot 里，archive=100、pin=200 之后。但行内还有一个官方内联渲染的 `⋯` 更多菜单按钮（不通过 slot 注册，直接由 `Rows.tsx` 渲染），它不受 order 控制。删除按钮视觉上会与 `⋯` 按钮相邻，位于 archive/pin 之后、`⋯` 之前或之后取决于 `Rows.tsx` 的布局逻辑。这是刻意的取舍：300 保证了与 archive/pin 的语义邻近性，用户 hover 时删除按钮在归档/置顶按钮附近出现，符合「破坏性操作聚集」的预期。

| 项 | 值 | 说明 |
|---|---|---|
| 行内按钮 slot | `sidebar.workspaces.session.row.action` | 官方行内按钮区 |
| 行内按钮 order | `300` | slot 注册顺序：archive=100、pin=200 之后。视觉上可能与官方内联 `⋯` 菜单相邻，不是视觉绝对最后 |
| 行内按钮视觉 | 纯图标 + Tooltip + aria-label | 图标复用 `IconTrashOutlineRegular` |
| 右键菜单 id | `session.delete` | 菜单项唯一标识（注意：这是 menu id，不是图标 key） |
| 右键菜单 order | `700` | archive=600 之后 |
| 右键菜单标志 | `danger: true`, `separatorBefore: true` | 防止误点，视觉分隔 |
| 图标 slot key | `session.delete` | 注册到 `contextMenu.icon` slot，与 menu id 同名但不同命名空间 |
| 图标组件 | `@deepseek-ai/dsh-client-ui-primitives` `IconTrashOutlineRegular` | 官方 trash 图标 |
| 菜单项 action id | `delete` | `MenuAction.id`，官方同列用 `pin`/`rename`/`archive`，作用域在 contribution 内 |
| 菜单反应式输入 | `observe: () => [sessions.list, layout.panelInfo, locale]` | `resolve` 里读各 source 的 `getSnapshot()`；官方 archive 项同法 |
| 菜单可见性判定源 | `ctx.sessions.list`（`byId[id].blank/running`） | 空白 → 返回 `[]`；运行中 → `disabled: true` |
| Client 半插件 `inject` | `['slots', 'locale', 'contextMenus', 'sessions']` | `sessions` 供菜单 resolve 与行内按钮取快照，不新增请求（`layout` 已随第一道禁用条件撤销而移除） |
| 公开入口共享方式 | 工厂作用域内的 store：`openDeleteRequest/closeDeleteRequest/subscribe/getSnapshot` | 两个入口只写 store，唯一发请求的地方是 `shell.overlay` 里的确认框 |
| 确认框 slot | `shell.overlay` | 全窗口浮层 |
| 确认框按钮顺序 | 「永久删除」在右、「取消」在左 | 与官方 `SessionArchiveConfirmDialog` 一致 |
| 确认框危险按钮样式 | `Button variant="outline"` + 内联 `style={{color:'var(--dsw-alias-state-error-primary)'}}` | 红色**文字**，非实心。官方用 CSS module 类 `.deleteAction`（`WorkspaceBrowser.module.css:601-603`），我们无法 import 它，用内联样式等价 |

## Locale

| 项 | 值 | 说明 |
|---|---|---|
| 命名空间 | `deleteSession` | `ctx.locale.register('deleteSession', {zh, en})` |
| 覆盖语言 | zh + en | 其余 locale 不单独翻译 |
| 绑定方式 | `ctx.locale.bind('deleteSession')` | Client 组件内 `t()` 使用 |

## 禁用条件（ADR-0004，第一道条件已于 2026-11-19 撤销）

**只剩一道**：运行中会话命中即置灰（行内按钮 `disabled: true` + Tooltip，右键菜单项 `disabled: true`）。

| 条件 | 判定 | 来源 |
|---|---|---|
| 运行中会话 | `useSessions(s => s.byId[sessionId]?.running === true)` | `SessionSummary.running`（client 侧 store，`dsh-api-session-controller/src/client/sessions/service.ts:27-65`），全局 props，无需 inject |

「当前会话」（`retainedBy.mainView > 0`）**不再置灰**——撤销理由是只剩一个会话时入口会永久不可用，而官方 `archiveSession` 本身也不拦当前会话。见 ADR-0004 的「修订 2026-11-19」。

客户端这道条件是「更早、更窄」的提示；权威判定在 Host 半的 `workspace/session-activity` waterfall（ADR-0001 第 0 步），覆盖子 agent / job / schedule。

## 行可见性矩阵（2026-11-19 修订）

| 行的状态 | 行内按钮 | 右键菜单项 |
|---|---|---|
| 普通会话 | 显示、可点 | 显示、可点 |
| 当前会话（`mainView > 0`，未在运行） | 显示、**可点** | 显示、**可点** |
| 运行中会话（`running === true`） | 显示、`disabled`（提示「会话正在运行，请先停止」） | 显示、`disabled` |
| 已归档（archived） | 显示、可点 | 显示、可点 |
| 空白新会话（blank，未落盘） | **不显示**（组件返回 `null`） | **不显示**（`resolve` 返回 `[]`） |
| 面板激活态（`activePanelId !== null`） | 与其它状态同规则 | 与其它状态同规则 |

优先级：空白 → 不显示；运行中 → 置灰；其余 → 可点。**唯一实现**是 `visibilityOf({ row, panelActive })` 的等价逻辑（实现期已简化为只吃 `row`），行内按钮与右键菜单共用，不允许两处各写一份。

「面板激活态」不再是独立一档——它原本只服务于已撤销的「当前会话」判定。

空白行判定（已验证）：`useSessions` 是 `GlobalStandardProps` 的成员（`dsh-client-ui-session/src/client/index.ts:157-164`），任何 slot 组件无需 `inject` 即可用。`SessionSummary.blank: boolean` 存在（`dsh-api-session-controller/src/client/contract/snapshot.ts:88`），写法 `useSessions(s => s.byId[sessionId]?.blank === true)`。官方 `ArchiveSessionRowButton` 在不允许时返回 `null`（`ArchiveSession.tsx:30`），照此形状。

## 删除后续动作

| 项 | 值 | 说明 |
|---|---|---|
| 自动切换会话 | **不做** | 删除成功后只关确认框 + 发 toast，panel 状态由 DSH 自行收敛（ADR-0006） |
| 撤销窗口 | 不提供 | 「永久删除」不可恢复，确认框已承担防误删职责（ADR-0005） |
| 失败提示 | `ctx.contextMenus.notify()` toast，带原因 | 任一带 `code` 的失败（`SESSION_ACTIVE` / `SESSION_NOT_FOUND` / `DELETE_FAILED`）都展示对应文案 |

## 安装

| 项 | 值 | 说明 |
|---|---|---|
| 安装命令 | `dsh plugin --profile desktop add link:<插件目录>` | 用 `link:` 方式挂载本地目录 |
| 生效 | 重启 DSH | 安装完成后重启 |
| 插件目录 | `<插件目录>` | 本仓库克隆到的位置 |

## 避免（反面模板）

- 不要在 `cordis.patch.yml` 里为 Client 半插 `<pkg>/client` 行——同一个包出现两个 Loader 源时，`client-modules` 直接抛 `package <name> resolves from multiple active Loader sources`，整包 client 半一行都注册不上（比「加载两次」更严重）。
- 不要用 `host.call` / `harness.handle`——那是动态包专属，profile bundle 不通。
- 不要用 `activePanelId` 判定「当前会话」，也不要用 `retainedBy.mainView` 决定是否允许删除——2026-11-19 起「当前会话」不再置灰，唯一禁用条件是 `running === true`（服务端由 `workspace/session-activity` 兜底）。
- 不要把 namespace 起成 `session.delete` 或 `delete-session`——与图标 key 混淆，应用 `deleteSession`。
- 不要手工清理 SQLite 查询索引——它是对账式自清理的。
- 不要把 `ctx.locale.register` / `ctx.slots.register` / `ctx.contextMenus.register` 裸调——全部包进 `ctx.effect(() => …, '<label>')`，否则插件禁用后注册残留（官方一律如此，如 `dsh-client-locale/src/client/index.ts:586`）。
- 不要在 Host 半 import 了 `@deepseek-ai/schemastery` 却不声明 peer 依赖——本插件补 `">=3.18.5 <4"`（本机安装树 3.19.0，与 better-sidebar 同区间）。
