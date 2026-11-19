# DSH 桌面端插件源码事实核查（实现期参考）

被测系统：DSH 桌面端 `0.2.2-rc.3`（未打包，`E:\develop\deepseek harness\resources\app\dsh\node_modules\@deepseek-ai\*` 可直接读源码）。
这份笔记是 ticket 01–06 实现期间对 DSH 源码的逐条核查结果，供后续维护与重审时复用。**它描述的是 DSH `0.2.2-rc.3` 本机解包态**；DSH 升级后需要重新核对。

核查方式：只读（ls / cat / grep / find）。行号一律是**本机这份解包源码的真实行号**，设计文档里的行号已在最后一节逐条对账。

约定缩写：

| 缩写 | 绝对路径 |
|---|---|
| `CM/` | `E:\develop\deepseek harness\resources\app\dsh\node_modules\@deepseek-ai\dsh-client-modules` |
| `WS/` | `...\@deepseek-ai\dsh-client-ui-workspace` |
| `CU/` | `...\@deepseek-ai\dsh-client-ui-context-menu` |
| `LOC/` | `...\@deepseek-ai\dsh-client-locale` |
| `WEB/` | `...\@deepseek-ai\dsh-host-webserver` |
| `WK/` | `...\@deepseek-ai\dsh-workspace` |
| `PROF/` | `C:\Users\Administrator\.dsh\profiles\desktop` |
| `SHELL` | `...\@deepseek-ai\dsh-web-frontend\dist\assets\index-Ciz7DZxv.js` |

---

## 1. Client 半工厂包契约（`__ModuleLoader__.load`）

### 1.1 调用点与门面

三处，缺一不可理解：

1. HTML 注入的排队门面（Host 侧生成，作为 `<script>` 内联注入 head）——`CM/src/index.ts:600-627`，函数 `bootInjections()`：

```js
window.__ModuleLoader__={
  mode:"queue", pendingQueue,
  load(registration){pendingQueue.push(registration)},
  create(options){ /* 取出 dsh-client-modules 自己的 registration，调 exports.createClientModuleSystem */ }
}
```
   `create()` 里硬性要求：`pendingQueue` 中必须已有 id 等于 `"@deepseek-ai/dsh-client-modules"` 的 registration，否则抛
   `client-modules: HTML did not preload @deepseek-ai/dsh-client-modules/client.js`。
2. 队列切活：`CM/src/client/system.ts:157-161`
   ```ts
   const pending = target.pendingQueue.splice(0)
   target.mode = 'live'
   target.load = (registration) => { this.register(registration) }
   ```
3. 真正的注册表写入：`CM/src/client/system.ts:166-179` `private register(registration)`。

所以 **bundle 脚本顶层必须同步调用 `window.__ModuleLoader__.load({id, factory})`**；`factory` 本体的所有副作用（含注入 `<style>`）都在 materialize 时才跑（`system.ts:9-16` 的模块注释明说）。

### 1.2 `id` 是否必须等于包名

**必须是包名（或 `<包名>/client`，两者等价）**，理由是三重：

- `register()` 存放键：`const ownerId = stripClientSuffix(registration.id)`（`system.ts:167`）。`stripClientSuffix` 只剥尾部 `/client`（`CM/src/client/manifest.ts:218-220`）。
- 图行（graph row）按包名索引，`import(id)` 用同一个键查 `factories`，对不上就是找不到工厂（`system.ts:379-393`）。
- 类型注释本身：「Entry name == package name.」（`manifest.ts:41-43`）。

不是「必须逐字相同」：写 `id: '@local/x/client'` 也能跑（会被剥成 `@local/x`）。**建议就写裸包名**，与 better-sidebar 一致。

### 1.3 未注册时的报错原文（三条，别混）

| 场景 | 原文 | 位置 |
|---|---|---|
| bundle 执行完但没注册这个 id | `client-modules: could not load "<id>": <url>: loaded without registering "<id>" via __ModuleLoader__.load`（外层） + `... loaded without registering "<id>" via __ModuleLoader__.load`（内层失败项） | `system.ts:224`、`system.ts:246` |
| 包内 chunk 脚本没注册 | `client-modules: bundle <url> loaded without registering "<id>" via __ModuleLoader__.load` | `system.ts:377` |
| 同一 bundle 被执行两次 | `client-modules: duplicate factory registration for "<id>" (bundle executed twice without invalidate?)` | `system.ts:173-176` |

注意 `arrive()`（`system.ts:209-249`）对 transport 失败会**同一 URL 重试一次**，然后回落到「单资源 URL」，最终把每条失败拼进上面那句 `could not load` 里，用 `; ` 分隔。排查时读整串，别只读第一段。

### 1.4 `factory` 收到 `require` 的机制

`system.ts:328-350` `makeRequire(ownerId, edges)`，同步函数，解析顺序（`system.ts:330-341`）：

1. seed word：`if (this.seed.has(spec)) return this.seed.get(spec)`
2. 已 materialize 的记录：`this.loadCache.get(stripClientSuffix(spec))`
3. 已注册未 materialize 的工厂：`this.materialize(id).exports`（递归，工厂式 CJS 不能给半成品 exports，所以**require 环是致命的**，报 `require cycle through "<id>"`）
4. 都没有则抛：
   `client-modules: require("<spec>") missed the module table — not a platform seed word, not a materialized module, and no registered package factory (a build-time externals drift, or a dynamic dependency that did not arrive)`

另外 `require` 上挂了两个附加能力（`system.ts:342-350`）：
- `require.asset(reference)` → 走 `resolveAsset` 钩子（`<pkg>/assets/*` 导出用）。
- `require.async(spec)` → 相对 `./client.<name>.js` 走包内 chunk；其它走 `import()`（异步图行导入，区别于同步 require）。

工厂的返回值就是「模块 exports」，而 **exports 本身被 Cordis Loader 当成插件对象**（`entries.ts` 的 `create(loader,id)` 用 `{name:id}` 建 entry）——所以工厂要 `return { inject, apply }` / `return { name, inject, apply }`。生产实例：`dsh-better-sidebar/lib/client.js` 末尾 `exports.apply = apply; exports.inject = inject;`。

### 1.5 seed word 白名单（真清单）

- **字段名**是 `staticModules`，类型 `Record<string, unknown>`，语义「platform-singleton specifier → shell instance」：
  - 类型声明：`CM/src/client/manifest.ts:381`（`ClientModuleCreateOptions.staticModules`）、`manifest.ts:489`（`ClientModuleSystemOptions.staticModules`）
  - 使用：`CM/src/client/system.ts:136` `this.seed = new Map(Object.entries(options.staticModules))`
- **清单本体**在 Web shell 的构建产物里，函数 `qJ()`，**`SHELL:198`**：

```js
function qJ(){return{
  react:rS, "react/jsx-runtime":aS, "react-dom":fS, "react-dom/client":mS,
  "@deepseek-ai/cordis":jC, zod:tN, "@tanstack/react-virtual":cN,
  "@deepseek-ai/dsh-client-store":NN, "@deepseek-ai/dsh-client-ui-slots":RN,
  "@deepseek-ai/dsh-client-ui-primitives":DK, "@deepseek-ai/dsh-client-ui-dockkit":FJ }}
```

共 **11 个**。注意：这批包**大部分不在 node_modules 里**（`@deepseek-ai/dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`、`dsh-client-store` 均无实体目录）——它们是 shell 内置单例，`grep` 不到 ≠ 不能用。
`staticModules` 由 `nG.run()` 传进去：`SHELL:198` 同处 `this.modules = r.create({boot:..., staticModules: qJ(), ...})`。**没有**任何用户可编辑的白名单配置文件；白名单是 shell 硬编码。想用一个新包只能靠 `cjs` 的图行（即 `dsh.client.inject` 里列出的包）。

---

## 2. Client 半如何被自动发现

### 2.1 `package.json` 字段名与读取代码

字段是 **`dsh.client`**，校验函数 `parseDshClient(pkgName, value)` —— **`CM/src/client/manifest.ts:173-195`**：

```ts
if (typeof decl.platform !== 'string') throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
const inject = optionalStringArray(pkgName, 'dsh.client.inject', decl.inject)
const external = optionalStringArray(pkgName, 'dsh.client.external', decl.external)
// immediately?: boolean 也在校验范围内
return { platform, ...(inject?{inject}:{}), ...(external?{external}:{}), ...(immediately?{immediately}:{}) }
```

→ 文档没提的两个字段：**`dsh.client.external`**（非 inject 的精确 module specifier）与 **`dsh.client.immediately`**（stage-one prefetch 标记）。

真正决定「加不加载」的地方 —— **`CM/src/index.ts:891-919`** `resolveMeta()`：

```ts
const decl = parseDshClient(packageName, (dsh as any).client)
if (decl === undefined || decl.platform !== 'web') return null            // :905
const clientRel = clientExportOf(packageName, pkg.exports)                // 读 exports["./client"]
if (clientRel === undefined) throw new Error(
  `client-modules: ${packageName} declares dsh.client but exports no "./client" bundle`)  // :907-909
```
`clientExportOf` 在 `CM/src/index.ts:204-214`，接受 `"./client": "./client/client.js"` 字符串形式，或 `{default: "..."}` 一层条件形式；其它形状抛 `exports["./client"] must be a string or an object with a string default`。

定位 package.json 的方式是 `locatePkgJson(loaderName, baseUrl)`（`CM/src/index.ts:933-...`）：**以 Loader 行的模块 specifier 为权威**做一次 resolve，再向上找最近声明该 name 的 package.json。结论：**只要这个包在 Loader 里有一行（Host 行），它的 client 半就会被自动发现**。

### 2.2 为什么 `cordis.patch.yml` 里不该为 client 插行

不只是「多余」，是**会炸**。同一个包出现两个 Loader 源时，`CM/src/index.ts:1089-1100` 直接抛：

```
client-modules: package <name> resolves from multiple active Loader sources: "<loaderName1>" from <baseUrl1>, "<loaderName2>" from <baseUrl2>; remove one entry
```

（`sourceKey = loaderName + baseUrl`，所以 `@local/x` 与 `@local/x/client` 两行必然算两个源。）文档说「会加载两次」方向对，但真实后果是**整包 client 半加载失败**，比「两次」更严重。

### 2.3 本机 `cordis.patch.yml` 现状（重要）

- **全局** `C:\Users\Administrator\.dsh\cordis.patch.yml`：只有一条 `insert` 的 `rea-mcp`（`@deepseek-ai/dsh-mcp-client`）。**没有任何插件相关的行**。
- **profile** `PROF/cordis.patch.yml`：只有官方包的 config 覆盖（ui-chat / ui-theme / llm-deepseek 等），没有第三方插件 insert。
- 说明本机现有第三方插件（clear-command / better-sidebar / …）**全部走各自的 bundle patch**，不是手写 profile 行。这是本项目应当照抄的安装通道（见 §10）。

---

## 3. `ctx.slots.register` 签名与三个 slot

### 3.1 完整参数签名

`ui-slots` 没有实体包（seed word），但完整声明被生成进了 Client API 目录：`...\@deepseek-ai\dsh-cordis-client-runner\src\client\api-catalog.ts:988`（`SlotCore.register` 两个重载）+ `:1044`（`StoredEntry.options` 的实际形状）。

归纳成可写代码的签名：

```ts
ctx.slots.register({
  name: SlotName,              // 必填，SlotMap 的 key
  id?: string,                 // list slot 的槽位键（同 id 会替换该 cell）
  key?: string,                // keyed slot 的键（与 id 二选一，按 slot 基数）
  order?: number,              // 默认 0，升序
  label?: string | (() => string),  // 仅 owner 会投影 label 的 slot 用；thunk 每次投影重读（i18n 跟随）
  locale?: string,             // locale 命名空间 → 决定组件收到的 t
  inject?: (...args) => object, // 注入面；返回 { hooks: {...} } 时 hooks 自动转成 use<Name> props
  select?: (owner) => unknown,
  children?: Record<slotName, SlotSpec>,   // 声明子 slot（owner 侧才用）
  store?: StoreDecl,
}, Component)
// 返回 disposer
```

**`priority` 不要传**：目录明确写「browser-half facade assigns one automatically, and it is LOWER than every shipped entry」——在 single/keyed slot 里那意味着你就是渲染者（覆盖官方 UI）。list slot 无此问题。

### 3.2 三个 slot 的真实注册/消费点

**(a) `sidebar.workspaces.session.row.action`** — `kind: 'list'`, `scope: 'root'`
- 声明（owner 侧）：`WS/src/client/index.ts:366-380`，`ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({ name:'sidebar.workspaces', children: { 'sidebar.workspaces.session.row.action': {kind:'list',scope:'root'}, ... } }, WorkspaceBrowser))`。契约文本在 `WS/src/client/contract/slots.ts:224-234`。
- 消费（渲染）：`WS/src/client/rows/Rows.tsx:748-760`：
```tsx
{!row.blank && (
  <span className={css.rowActions} onClick={(e)=>{e.stopPropagation()}}>
    {renderFactorySlot('contextMenu.button', { target:{kind:'session', value:{sessionId:node.id, displayTitle:row.title}}, ... })}
    <span className={css.rowQuickActions}>
      {renderSlot('sidebar.workspaces.session.row.action', { sessionId: node.id, displayTitle: row.title })}
    </span>
  </span>
)}
```
  → **`⋯` 触发器是 `contextMenu.button` factory，排在 row.action 之前**；整条 `rowActions` 对 `row.blank` 行整体不渲染（空白行天然没有 slot）。官方注册：`WS/src/client/index.ts:391-394`（archive=100、pin=200）。
- owner props：`SessionRowOwnerProps = { sessionId, displayTitle }`（`WS/src/client/contract/slots.ts:94-100`）。

**(b) `shell.overlay`** — `kind: 'list'`, `scope: 'root'`, owner props = `{}`
- 声明 + 消费：`dsh-client-ui-layout\src\client\index.ts:107`、`:200`，以及 `dsh-client-ui-layout\src\client\AppFrame.tsx:281` `renderSlot('shell.overlay', {})`，容器 `AppFrame.tsx:328` `<div className={css.overlayLayer} data-shell-overlay>`。
- 语义（catalog `slot-catalog.ts:4000-4075`）：**点击穿透**，条目自己 opt-in pointer events；`id` 用新值就是并列追加（官方 20 个条目，含 `workspace.session-archive`、`workspace.row-toast`）。
- 官方注册样例：`WS/src/client/index.ts:397-408`。

**(c) `contextMenu.icon`** — `kind: 'keyed'`
- 声明：`CU/src/client/index.ts:40`；消费则发生在 context-menu 的菜单渲染里按 action 的 `icon.key` 派发。
- 注册样例：`WS/src/client/index.ts:317-325`：
```ts
ctx.slots.inject('contextMenu.icon', function* () {
  for (const [key, Icon] of Object.entries({ 'workspace.rename': IconEditOutlineRegular,
    'workspace.trash'... /* 实际是 'workspace.delete': IconTrashOutlineRegular */ }))
    yield ctx.slots.register({ name: 'contextMenu.icon', key }, Icon)
})
```
- 已占用 key（catalog `slot-catalog.ts:152`）：`open-in-app.application`、`sidebar.close`；`keyDomain` 说明是「open: 任意字符串（无编译期键集）」，未来作者不冲突。
- 组件收到的 props：`ContextMenuIcon = { key: string; src?: string }`（`CU/src/client/types.ts:59-63`）；实际官方 Icon 组件只吃图标自己的 props（`size`），key 由注册时字面量决定。

### 3.3 `PropsRuntime` / `PropsLocale` / `PropsHooks` 各自怎么来

声明（全部来自 `dsh-cordis-client-runner/src/client/api-catalog.ts`）：

| 类型 | 行 | 声明 |
|---|---|---|
| `PropsRuntime<K, EntryKey>` | `:832` | `OwnerOf<K> & KeyPropsOf<K,EntryKey> & SlotInjectFace<SlotInjectOf<K>> & ScopeStandardProps<ScopeOf<K>>` |
| `PropsLocale<N>` | `:820` | `N extends keyof LocaleNamespaceMap & string ? { t: TranslateNS<N> } : object` |
| `PropsHooks<HS>` | `:812` | `{ [N in keyof HS & string as \`use${Capitalize<N>}\`]: SnapshotSelectorHook<...> }` |
| `InjectFace<I>` | `:672` | `I extends {hooks: infer HS} ? Omit<I,'hooks'> & PropsHooks<HS> : I` |
| `ComposedProps<...>` | `:532` | `PropsRuntime & PropsRenderSlots & PropsRenderFactories & PropsStore & InjectFace<I> & MatchedShare & HocShare & PropsLocale<N>` |

来源解释：
- `OwnerOf<K>` = owner 渲染时传下来的数据（row.action 就是 `sessionId`/`displayTitle`）。
- `ScopeStandardProps` = `GlobalStandardProps` 的声明合并（**不用写进 inject**）：
  `dsh-client-ui-session/src/client/index.ts:156-164` 提供 `useSessions / useSessionStatus / useSessionRetainInfo / useSessionAccess`；ui-workspace 提供 `useWorkspaces / useWorkspaceAccess / usePanelInfo`；`dsh-api-remote-access` 提供 `useRemoteAccess`；`useResource`、`useContextMenu` 亦由各自包合并。完整列表见 `slot-catalog.ts` 每个 slot 的 `standardProps` 数组。
- `PropsLocale` 的 `t` 由**注册时的 `locale` 选项**驱动；运行期由 `ctx.slots.installLocale(locale)`（`LOC/src/client/index.ts:585` 注释：「install it so the render machinery can synthesize the `t` standard seat」）合成。
- `PropsHooks` 由 `inject: () => ({ hooks: {...} })` 升格而成，键名首字母大写加 `use` 前缀 —— `hooks: { archived }` → props `useArchived`。

官方三段式实例：`WS/src/client/contract/slots.ts:511-516`
```ts
export type SessionArchiveConfirmProps =
  PropsRuntime<'shell.overlay'> & PropsLocale<'workspace'>
  & InjectFace<SessionArchiveConfirmInjected>       // 展开成 hooks → useArchiveRequest …
  & PropsHooks<SessionArchiveConfirmInjected['hooks']>
```
`row.action` 版本：`WS/src/client/contract/slots.ts:344-348`（`PropsRuntime<'sidebar.workspaces.session.row.action'> & PropsLocale<'workspace'> & InjectFace<Injected>`）。

**两条硬规则**（`dsh-cordis-client-runner/src/client/slot-catalog.ts:72-79` `CLIENT_NOTES`）：
1. 必须 `inject: ['slots']`，否则 seat 被扣留。
2. 每次注册都要包 `ctx.slots.inject(key, () => ctx.slots.register(...))` —— slot 只在声明它的 entry 挂载期间存在，注册到未声明 slot **会抛**。

---

## 4. 官方「归档会话」完整实现（本项目 prior art）

### 4.1 文件清单

| 角色 | 文件:行 |
|---|---|
| 行内按钮组件 | `WS/src/client/session-actions/ArchiveSession.tsx:25-43` |
| 确认对话框（`shell.overlay`） | `WS/src/client/session-actions/ArchiveSession.tsx:53-67`（外壳）+ `:70-123`（表单） |
| 活动文案渲染 | `WS/src/client/session-actions/ArchiveSession.tsx:130-142` |
| slot 注册（两个入口） | `WS/src/client/index.ts:391-394`（行内）、`:397-408`（overlay） |
| 右键菜单注册 | `WS/src/client/session-actions/context-menus.tsx:19-31`（通用 `register`）、`:61-69`（archive） |
| 菜单派发（`ctx.contextMenus`） | `CU/src/client/types.ts:86-102`（`MenuContribution`）、`:118-155`（`ContextMenus`） |

### 4.2 行内按钮（`ArchiveSessionRowButton`）

```tsx
export function ArchiveSessionRowButton({ sessionId, useArchived, useSessionAccess, archiveSession, unarchiveSession, t }: SessionRowActionProps<ArchiveSessionInjected>) {
  const archived = useArchived(set => set.has(sessionId))
  const allowed = useSessionAccess(sessionId, archived ? 'workspace/unarchiveSession' : 'workspace/archiveSession')
  if (!allowed) return null                                  // ← 不允许就整体不渲染
  return (
    <Tooltip label={t(archived ? 'actions.unarchive' : 'actions.archive')} side="bottom" align="end" delayMs={500} portal>
      <button type="button" className={css.iconButton}
        aria-label={t(archived ? 'menu.unarchiveSession' : 'menu.archiveSession')}
        onClick={() => { (archived ? unarchiveSession : archiveSession)(sessionId) }}>
        {archived ? <IconUnarchiveOutlineRegular size={14} /> : <IconArchiveOutlineRegular size={14} />}
      </button>
    </Tooltip>
  )
}
```
要点：**纯图标 14px + Tooltip(delay 500ms) + aria-label**，不自己 `stopPropagation`（`Rows.tsx:748-760` 的外层 span 已处理）。

### 4.3 可见性 / 禁用判定

- 「不允许 → `return null`」：上面 `:30`。**注意官方是隐藏，不是置灰**（与 ADR-0004 的置灰决策不同，见最后一节）。
- `useArchived` 来自 `hooks: { archived }`，是 registry-global 的 `ReadonlySet<SessionId>`（`WS/src/client/contract/slots.ts:396-416` `ArchiveSessionInjected`）。
- 运行中判定在 Host：`archiveSession` 被 `WorkspaceActiveSessionError` 拒后，Client 弹「停止并归档」确认框（`contract/slots.ts:417-437` `SessionArchiveConfirmInjected.stopAndArchiveSession`）。

### 4.4 菜单注册 API（`ctx.contextMenus.register`）

`MenuContribution<K>`（`CU/src/client/types.ts:86-102`）：

```ts
{
  id: string            // 唯一标识；同一 target 内重复 id 会失败
  target: K             // ContextMenuTargetMap 的键：session/file/directory/url/image/tab
  order: number
  observe?(target): ObservableSnapshot<unknown>[]   // 反应式重算输入
  resolve(target, signal: AbortSignal): readonly MenuAction[] | Promise<...>
}
// 返回 unregister
```

`MenuAction` = `MenuActionView`（`types.ts:64-77`：`id,label,commandId?,disabled?,icon?{key,src},danger?,separatorBefore?,afterContent?,children?`）+ `failureLabel?` + `run?(): void|Promise<void>`（`types.ts:78-84`）。

官方 archive 项（`context-menus.tsx:61-69`）：

```ts
register('archive', 600, ['workspace/archiveSession','workspace/unarchiveSession'], (target) => {
  const restoring = archived(target)
  if (!allowed(target, restoring ? 'workspace/unarchiveSession' : 'workspace/archiveSession')) return []
  return [{
    id: 'archive', label: t(restoring ? 'menu.unarchiveSession' : 'menu.archiveSession'),
    icon: { key: restoring ? 'workspace.unarchive' : 'workspace.archive' },
    separatorBefore: true, afterContent: true,
    ...restoring ? {} : { commandId: 'session.archive' },
    run: () => { (restoring ? actions.unarchiveSession : actions.archiveSession)(target.sessionId) },
  }]
})
```
外层注册（`context-menus.tsx:22-31`）：
```ts
ctx.effect(() => ctx.contextMenus.register({
  id: `session.${id}`, target: 'session', order,
  observe: ({ sessionId }) => [ctx.workspaces.list, ctx.locale,
    ...endpoints.map(action => ctx.remoteAccess.source('session', sessionId, action))],
  resolve,
}), `ui-workspace: ${id} menu`)
```

官方 order 实测（全部来自 `context-menus.tsx`）：`pin=100`、`rename=200`、`fork=300`、`id(=copy)=450`(separatorBefore)、`archive=600`(separatorBefore + afterContent)。`target` 家族里 `session` 的额外字段是 `{ sessionId, displayTitle }`（`CU/src/client/types.ts:28-43`）。**没有 `danger` 的官方 session 项**——`danger` 只在 `workspace.delete` 用过（`WS/src/client/index.ts:319-324`）。

### 4.5 `notify` 的调用形态

`ContextMenus.notify(text, success?, action?)`（`CU/src/client/types.ts:143-152`，实现 `CU/src/client/index.ts:71-83`）：

```ts
notify(text: string, success = false, action?: {
  label: string; run: () => void | Promise<void>; failureLabel: string
}): void
```
真实调用：`dsh-client-ui-file-actions/src/client/context-menus.tsx:30-45`（带 action）、`:46` `ctx.contextMenus.notify(t('menu.copied'), true)`。
注意：`action.run()` 被拒时会**再弹一条** `action.failureLabel` 的 toast（`CU/src/client/index.ts:78-80`），且只在「当前 notice 仍是这一条」时才执行（`:76`）。

---

## 5. `@deepseek-ai/dsh-client-ui-primitives` 真实导出

**该包在 node_modules 中不存在**（`ls @deepseek-ai | grep primitiv` → 空）。它是 seed word，实体在 shell bundle 里。完整导出表从 `SHELL:198` 的导出对象提取（321 项，去重后全列于此，节选关键项）：

**通用组件**：`Button`、`Tooltip`、`Modal`、`Menu`、`MenuGroup`、`MenuItemButton`、`MenuSurface`、`Input`、`Checkbox`、`Switch`、`Tag`、`Pill`、`Toast`、`HoverCard`、`HoverCardGroup`、`InlineEditor`、`SegmentedControl`、`SegmentedTabs`、`SettingsForm`、`SettingsFormModel`、`SettingsSecretField`、`SettingsValueField`、`JsonTree`、`CodeBlock`、`FenceCodeBlock`、`FenceMathBlock`、`TerminalBlock`、`SearchBlock`、`WebBlock`、`ReadBlock`、`DiffBlock`、`MarkdownText`、`FileTypeIcon`、`StateDot`、`RiskConfirmation`、`PermissionIcon*`、`PluginArtwork*`、`AnimatedRows`、`DisclosureRow`、`DraggableImage`、`ZoomControls`、`ReferenceChip`、`QuotePreview`、`UserMessageBubble`…

**没有 `Dialog`**（`grep -o "as Dialog\b"` 无命中；官方所有对话框命名都是 `XxxDialog` 组件名，底层统一是 `Modal`）。

**Hook/工具**：`useAnchoredMaxHeight`、`useClipboardCopy`、`useCodeHighlighter`、`useDismissOnOutsidePointer`、`useModalLayer`、`usePointerGrace`、`useRowDragPreview`、`useDetailDocumentLabels`、`useMarkdownDelegate`、`writeClipboard`、`closeTopModal`、`modalSelector`、`isBehindModal`、`classifyFileType`、`relativeTime`、`formatQuoteText`…

**图标**：`Icon<Name>OutlineRegular` 与 `Icon<Name>OutlineMedium` 成对存在（另有些 `FillRegular/FillMedium`），`IconTrashOutlineRegular` 与 `IconTrashOutlineMedium` **都存在**（`SHELL` 导出表：`IconTrashOutlineMedium: GU, IconTrashOutlineRegular: JU`）。

关键 props（从官方调用点反推，全部实测）：

| 组件 | props |
|---|---|
| `Button` | `variant`（实测值 `"outline"`；`ApprovalCard`/`ChatView`/`DirectoryBrowser` 等都用这个）、`disabled`、`onClick`、`className`、`autoFocus`、`data-modal-autofocus`、`size: 'sm'` |
| `Tooltip` | `label`（必）、`side`（如 `"bottom"`）、`align`（如 `"end"`）、`delayMs`、`portal` |
| `Modal` | `open`（必）、`onClose`、`closeLabel`、`title`、`description`、`footer`（ReactNode）、`tone`（如 `"warning"`）、`headless`、`className`、children |
| 图标 | `size: number`（官方行内统一 `14`）、`className` |

**是否属于 seed word：是**（`@deepseek-ai/dsh-client-ui-primitives` 在白名单里，可 `require`）。better-sidebar 的真实做法：`require("@deepseek-ai/dsh-client-ui-primitives")`（`lib/client.js:31`），并在 `peerDependencies` 里声明版本（`package.json:85`）。

---

## 6. `dsh-client-locale` 的 `register` / `bind`

### 6.1 重载

**`LOC/src/client/index.ts:386-403`** 两个公开重载 + `:404` 实现体：

```ts
// 重载 1（强类型，ns 必须是 LocaleNamespaceMap 的键）
register<N extends Extract<keyof LocaleNamespaceMap, string>>(
  ns: N, dicts: Record<BuiltInLocaleId, LocaleDictOf<N>> & Record<LocaleId, LocaleDictOf<N>>,
): () => void
// 重载 2（单语，未类型化）
register(ns: string, locale: string, dict: LocaleDict): () => void
// 实现体（接受两种 arm）
register(ns: string, localeOrDicts: string | Record<string, LocaleDict>, dict?: LocaleDict): () => void
```

`BuiltInLocaleId = 'zh' | 'en'`（`LOC/src/locale-settings.ts:15-18`，`LOCALE_IDS = ['zh','en']`）——**所以强类型 form 只要求 zh + en 两个键，正好对得上 ADR 的 `{zh, en}`**。

结论：文档说的「一次调用传 dicts 对象」**运行期成立**（实现体 `Object.entries(localeOrDicts)`），**但如果用 TypeScript 且 `ns` 没在你的包里做过 `LocaleNamespaceMap` 声明合并，2 参数形式不在任何公开重载上，会报「Expected 3 arguments」**。
- 绕法 A（推荐给纯 JS 插件）：不管类型，直接 2 参数调用，运行正常。
- 绕法 B（TS）：加声明
  ```ts
  declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap { deleteSession: Dict }
  }
  ```
  （`LOC/src/client/index.ts:42-44` 就是在给 `LocaleNamespaceMap` 做合并的官方样例。）
- 绕法 C（最保守，生产实例）：**better-sidebar 用的是 3 参数单语 form**，调两次（`lib/client.js:37902-37903`）：
  ```js
  const offZh = ctx.locale.register(LOCALE_NS, "zh", zh);
  const offEn = ctx.locale.register(LOCALE_NS, "en", en);
  ```

### 6.2 `bind`

**`LOC/src/client/index.ts:452-470`**（`bind(ns)` 两个重载 + 实现）：
```ts
bind(ns: string): Translate {          // 返回值按 ns 记忆化，稳定引用
  let t = this.bound.get(ns)
  if (!t) { t = (key, params) => this.translate(ns, key, params); this.bound.set(ns, t); return t }
  return t
}
```
- 稳定引用 → 可安全塞进 inject 面而不破坏 memo。
- **读取时**才解析当前语言（不是绑定时），所以 locale 切换自动生效。
- 在 slot 组件里一般不用手动 `bind`：注册时传 `locale: 'deleteSession'`，框架给你 `t`。
- 在 `apply()` 里想自己用（比如给菜单 `label` 求值）就 `const t = ctx.locale.bind('deleteSession')`。

### 6.3 重复注册的报错

| 场景 | 报错原文 | 位置 |
|---|---|---|
| 同一 `(ns, locale)` 注册两次 | `locale namespace "<ns>" already has locale "<locale>"` | `LOC/src/client/index.ts:421-423` |
| 非法 locale id（非 BCP 47 样式） | `locale id "<id>" is not a BCP 47-style tag` | `:407-409` |
| `addLanguage` 同名语言已存在 | `locale "<id>" is already registered` | `:279` |

注意粒度：**是 `(ns, locale)` 而不是 `ns`**。所以 ns 重名但语言不同不会抛，只会产生两套并存字典（后注册的同一 locale 才抛）。插件卸载时 disposer 会按引用相等删除自己那几份（`:429-441`），所以热重载安全。

---

## 7. Host 侧：`dsh-host-webserver` 路由

### 7.1 `register` 签名

`WEB/src/index.ts:49-58`：
```ts
export type WebRouteKind = 'exact' | 'prefix'
export interface WebRoute {
  kind: WebRouteKind
  path: string                     // 绝对 pathname，无尾斜杠
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}
```
`register(route): () => void`（`WEB/src/index.ts:445-455`），重复 `(kind,path)` 抛 `webserver: duplicate <kind> route "<path>"`（`:447-449`）。
匹配语义（`WEB/src/index.ts:48`、`:654-663`）：`prefix p` 命中 `p` **和** `p/<anything>`；多个命中取**最长 prefix**；exact 表优先于 prefix 表。
另有 `WebResourceRoute`（`{kind, path, resource: (Request)=>Promise<Response>}`，`:61-75`）——只想写 Web Fetch 风格时用 resource 分支，但 handler 分支更适合读 body。

服务名：`declare module ... { interface Context { webServer: WebServer } }`（`WEB/src/index.ts:31-32`），`WebServer extends Service`（`:357`）。
必须用 `ctx.effect(() => ctx.webServer.register({...}), 'label')` 包住，否则 HMR/卸载留孤儿路由（官方全部这么写，如 `dsh-host-open-in-app/src/index.ts:193`）。

### 7.2 handler 形态与读写 body/JSON

`(req, res)` 就是原生 `node:http` 的 `IncomingMessage` / `ServerResponse`，**handler 独占整个响应生命周期**（可以挂住 SSE）。

完整可抄范式在 `dsh-host-open-in-app/src/index.ts`：

```ts
// 96-103：JSON 响应
function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}
// 106-119：有界读 body（无 setEncoding 时 chunk 是 Buffer）
async function readBoundedBody(req) {
  const chunks = []; let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) { req.resume(); return null }   // 超限先排空再拒绝
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size).toString('utf8')
}
```
method 校验 + `content-type` 精确比对（essence 必须是 `application/json`）+ `JSON.parse` + 字段校验见 `:196-280`，它们的路由注册见 `:193-320`。上面这段是**本项目 Host 半可以直接照抄的最小骨架**。

### 7.3 `ctx.connection.requestRejection(req)` 的真实语义

`dsh-client-connection/src/rpc-host.ts:122-131`（Host 实现）+ `src/rpc.ts:219-239`（契约）：

```ts
requestRejection(request: ConnectionTrustRequest): 401 | 403 | undefined {
  const admission = this.admit(request)
  return 'rejection' in admission ? admission.rejection : undefined
}
admit(request) {
  if (!this.isTrusted(request)) return { rejection: 403 }              // Host/Origin 栅栏
  if (this.disposed) return { rejection: 401 }
  const secure = ...protocol === 'https:'
  if (this.browserAuth.isAuthenticated(request, secure)) return { peer: this.browserPeer }
  const id = this.browserAuth.authenticateApi(request, secure)
  ...return record === undefined ? { rejection: 401 } : { peer: record.peer }
}
```
→ **不是「同源放行」，是「受信 Host/Origin + 已认证 browser 凭据（或 API key）」**。返回 `401`/`403` 或 `undefined`。
- 同源页面里 `fetch('/your/api/x')` 会带上 browser 认证 cookie，所以通常 `undefined`，可用。
- `403` = Host/Origin 不在 trustedHosts；`401` = 没凭据/凭据失效/服务已释放。
- 用法（官方唯一形态）：`dsh-host-open-in-app/src/index.ts:185-192`
```ts
const rejection = connectionOf(ctx).requestRejection(req)
if (rejection === undefined) return false
res.statusCode = rejection; res.end(); return true
```
  注意 `connection` 在 Host 侧的取法：官方用 `Reflect.get(ctx, 'connection')` 并本地声明最小接口（`open-in-app/src/index.ts:80-88`），因为「its package is browser-side」。本项目照抄这个姿势最省事（`inject: ['connection']` + 本地 interface）。

---

## 8. `dsh-workspace` registry 与活动闸门

### 8.1 集合与写操作（`WK/src/index.ts`）

| 成员 | 行 | 签名 / 语义 |
|---|---|---|
| `archivedSessionIds` | `:360-362` | `get archivedSessionIds(): readonly SessionId[]`（归档顺序） |
| `pinnedSessionIds` | `:439-441` | `get pinnedSessionIds(): readonly SessionId[]`（最新在前） |
| `archiveSession` | `:381-409` | `(sessionId, options?: { stopActivity?: boolean }) => Promise<void>` |
| `unarchiveSession` | `:420-436` | `(sessionId) => Promise<void>` |
| `pinSession` | `:450-467` | `(sessionId) => Promise<void>` |
| `unpinSession` | `:477-491` | `(sessionId) => Promise<void>` |

**幂等性（逐条核实）**：
- `archiveSession`：`if (archivedSessionIds.includes(sessionId)) return`（`:385`）→ 不写、不问、不停。**另外会校验会话存在**（`:386-388`，抛 `WorkspaceUnknownSessionError`），并在同一笔写入里清 pin（`:398-401`）。
- `unarchiveSession`：`if (!state.archivedSessionIds.includes(sessionId)) return`（`:425`）；**注释明确「runs no session-existence check because removing an id cannot introduce an unknown one」**（`:412-417`）。
- `unpinSession`：`:482` 同形，注释 `:469-471` 同义。
- 全部写在 `this.enqueueOperation(...)` 串行链里（`:382`、`:421`、`:478`），与并发 archive/pin 不竞态。

**所以「删文件后再清 registry」的顺序无所谓**，且重复调用安全——ADR-0001 的判断成立。

### 8.2 `workspace/session-activity` waterfall

事件声明 `WK/src/index.ts:118-135`（`@mode waterfall`）：

```ts
'workspace/session-activity'(
  request: SessionActivityRequest, next: () => Promise<readonly SessionActivity[]>,
): Promise<readonly SessionActivity[]>
```
官方调用（`WK/src/index.ts:389-393`，在 `archiveSession` 内）：
```ts
const activity = await this.ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
if (activity.length > 0) throw new WorkspaceActiveSessionError(sessionId, activity)
```
官方**监听者**写法（`dsh-agent/src/archive-admission.ts:27-33`）：
```ts
ctx.on('workspace/session-activity', async ({ sessionId }, next) => {
  const running = lookup(sessionId)?.status === 'running'
  const rest = await next()
  if (!running) return rest
  return [{ kind: 'turn' } satisfies SessionActivity, ...rest]
})
```
`SessionActivity` / `SessionActivityItem` 定义在 `WK/src/types.ts:39-60`（`kind` 由 `SessionActivityKindMap` 声明合并扩展；`items?: {id,label?}[]`，`turn` 家族无 items）。
当前 provider：`dsh-agent`（turn）、`dsh-jobs`（job）、`dsh-schedule`（schedule）、`dsh-subagent`（subagent）。

### 8.3 `WorkspaceActiveSessionError`

`WK/src/index.ts:63-74`：
```ts
export class WorkspaceActiveSessionError extends Error {
  constructor(readonly sessionId: SessionId, readonly activity: readonly SessionActivity[]) {
    super(`cannot archive session '${sessionId}': the session is active (${activity.map(e => e.kind).join(', ')})`)
    this.name = 'WorkspaceActiveSessionError'
  }
}
```
同类错误族（同文件）：`WorkspaceUnknownSessionError`（`:48-58`，`verb: 'archive'|'pin'`）、`WorkspaceArchivedSessionPinError`（`:76-...`）。
**客户端侧跨包识别**不能靠 `instanceof`（bundle 不共享错误类身份），官方按 `name` 判：`WS/src/client/index.ts:432-438`
```ts
if (!(reason instanceof Error) || reason.name !== 'WorkspaceArchiveError') return undefined
const { rpcError } = reason as WorkspaceArchiveError
return rpcError.code === 'workspace/session-active' ? rpcError.details.activity : undefined
```
（RPC 层把 `WorkspaceActiveSessionError` 变成 `workspace/session-active` code —— 见 `dsh-api-workspace-controller/src/types.ts:45`。）

---

## 9. 会话根目录怎么算（`~/.dsh/sessions`）

### 9.1 两层：DSH home 与会话 root

1. **DSH home**：`@deepseek-ai/dsh-home-paths/src/index.ts`
   - `DSH_HOME_ENV = 'DSH_HOME'`（`:18`）、`DSH_HOME_DIR_NAME = '.dsh'`（`:12`）
   - `defaultDshHome() = join(homedir(), '.dsh')`（`:70-72`）
   - `resolveDshHome(configured?, env = process.env)`：优先级 **显式 configured > `$DSH_HOME`（空/纯空白视为未设）> `~/.dsh`**（`:126-137`）
   - `dshHomePath(...segments)`（`:165-167`）= `join(resolveDshHome(), ...segments)`
2. **会话 root**：不是硬编码 `home/sessions`，而是 `dsh-session-persistence-jsonl` 的必填 Config `root`（`dsh-session-persistence-jsonl/src/index.ts:93-104`，注释：「Required (no default)」）。shipped 组合在 **`dsh-base/cordis.patch.yml:138-141`**：
   ```yaml
   - id: session-persistence-jsonl
     name: '@deepseek-ai/dsh-session-persistence-jsonl'
     config:
       root: !!js dshHomePath('sessions')
   ```
   即默认落 `~/.dsh/sessions`，但**可被上层 patch 覆盖**。

### 9.2 目录布局（实测本机，与代码一致）

```
~/.dsh/sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.v4.jsonl.zstd
```
- `projectKey(cwd)`：`/`、`\`、`:` → `-`（连续压成一个）；非 `[A-Za-z0-9._-]` 的码元 → `~XXXX`（大写 UTF-16 hex，4 位）；首尾包 `--`；超 251 字符截断。见 `dsh-session-persistence-jsonl/src/format.ts:222-247`。`cwd === undefined` → 目录名 `_no-cwd`（`:249-257`）。
- 会话目录名 = `encodeSegment(sessionId)`（`format.ts:199-214`）；**`sessionId` 自身就带 `session-` 前缀**（`session-<uuid>`，生成点如 `dsh-api-session-controller/src/agent.ts:433` `${`session-${randomUUID()}`}`），所以目录名形如 `session-bf025748-…`。
- 实测：`~/.dsh/sessions/--E-ai~7F16~7A0B~9700~8981~…-dsh-delete-session--/session-bf025748-2511-430b-8ca7-e7ff95fec92a/session.v4.jsonl.zstd`。

**没有 `<project>/<uuid>/` 这种不带前缀的目录**——ADR-0001 说的「两种历史命名并存」在当前版本不成立（见最后一节）。

### 9.3 推荐的取值代码（比 glob 更稳）

本机 profile 的 `node_modules/@deepseek-ai/` 是**空的**，但安装树里所有包都能被解析（见 §10.4），所以两种都可行：

```js
// 方式 A（推荐）：直接问持久化层这一个会话的落盘位置，不用自己拼路径
const snap = await ctx.sessionPersistence.stat(sessionId)   // undefined = 不存在
const file = snap?.location?.path                           // 绝对路径：…/<sessionId>/session.v4.jsonl.zstd
const dir  = file && path.dirname(file)                     // 会话专属目录
```
- 服务名 `sessionPersistence`：`dsh-session-persistence/src/index.ts:120`（`Context { sessionPersistence: SessionPersistence }`）。
- `stat(id, options?) → Promise<SessionPersistenceSnapshot | undefined>`（`src/index.ts:203`）。**`undefined` 就是权威的「会话不存在」**。
- `SessionPersistenceSnapshot.location?: SessionLocation = { kind: string; path: string }`（`src/index.ts:62-67` + `src/errors.ts:85-90`；注释：unmaterialized pending session 没有 location → 正好用来判定的「空白行」）。

```js
// 方式 B：自己算 root（当 A 不适用时，例如要做全目录扫描/兜底清理）
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
const root = dshHomePath('sessions')   // 尊重 $DSH_HOME；但会漏掉被 patch 覆盖的 config.root
```

本机 `$DSH_HOME` 未设置，实际解析为 `C:\Users\Administrator\.dsh`。

---

## 10. 插件安装机制

### 10.1 bin 暴露什么

`@deepseek-ai/dsh/package.json`：`"bin": { "dsh": "lib/bin.js" }`。
`lib/bin.js` → `lib/bin-CwxESKe-.js` 的 `runCli()` → `parseDshArgs()`（`src/args.ts:143-210`），**只有四种 mode**：

| mode | 触发 | 说明 |
|---|---|---|
| `profile` | 默认 / `dsh <name>` / `dsh --profile <name>` | 启动一个 profile |
| `plugin` | `dsh plugin --profile <name> <args…>` | **把 `args` 原样转发给 profile 目录内的 pnpm**（`src/args.ts:187-199`） |
| `dump-config` | `--dump-config` | 打印合成后的 entry 树 |
| `dump-config-schema` | `--dump-config-schema` | 打印 JSON Schema |

**没有 `plugin add/remove/link` 这类子命令实现** —— `add`/`remove`/`why` 都是 **pnpm 的**子命令（`src/args.ts:196` 的 argument 描述写得很直白：「pnpm arguments, forwarded verbatim (add \<pkg\>, remove \<pkg\>, why \<pkg\>, ...)」）。

### 10.2 `--profile desktop` 的特殊门禁（会卡住照抄 ADR 的命令）

`src/args.ts:83-87`：
```ts
function rejectElectronProfile(program, profile) {
  if (profile.toLowerCase() === 'desktop')
    program.error('error: profile "desktop" is managed exclusively by the Electron application')
}
```
`plugin` 分支里是 `if (!manageDesktopProfile) rejectElectronProfile(...)`（`src/args.ts:198`）。
`manageDesktopProfile: true` 只由**桌面端自带的 CLI 载体**传入：`dsh-desktop-host/lib/cli.js:57-75` `runDesktopCli()`。而 PATH 上的 `dsh` 正是它——`resources\app\runtime\cli\bin\dsh.cmd` 调用 `"…\DeepSeek Harness.exe" --expose-internals "…dsh-desktop-host\lib\cli.js" %*`。

→ **必须用桌面安装目录里那个 `dsh.cmd`（或 `runDesktopCli` 路径），不能用 `node node_modules/@deepseek-ai/dsh/lib/bin.js`**，否则 desktop profile 直接被拒。
另外 `src/plugin.ts:16-20` `requireDesktopProfile()`：profile 目录必须已有 `package.json`，否则报
`Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop.`

### 10.3 一次 `add link:...` 到底改哪些文件

`src/plugin.ts:88-108` → `dsh-plugin-manager` `runProfilePnpm`（`src/operations.ts:305-...`）：

1. `anchorPathSpec` 只改写**相对**路径（`operations.ts:71-76`，只匹配 `^(file|link):?\.{1,2}…$`）。→ `link:E:\develop\…` 原样透传。
2. `execa(pnpm, [...args, ...args.map(anchorPathSpec)])`，`cwd = profile 目录`（`:394-402`）。
   - **pnpm 侧改动**：`package.json` 的 `dependencies` 加 `"@local/x": "link:E:\\develop\\…"`；`pnpm-lock.yaml`；`node_modules/<name> → 目标目录` 符号链接；`.plugin-manager/logs/operation-*/pnpm.log`（`:311-315`）。
3. pnpm 成功（exit 0 且未被 stall 终止）后 reconcile（`operations.ts:96-127`）：
   - 对**本次新增**的每个 dependency 读 `dsh.bundle` 元数据；
   - 没有 `dsh.bundle` → 只打 warning，**不加入 profile 层**：
     `dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer`（`:109`）
   - 有 → 校验 platforms，预加载其 patch 文件，然后把包名 **append 到 `dsh.profile.bundles`** 并原子写回 `package.json`（`:115-126`）。`dsh.profile.bundles` 顺序 = 层顺序，新装的永远在**最后**。
4. 失败回滚：`package.json` + `pnpm-lock.yaml` 恢复到运行前，必要时重装（`:324`、`:540-561`）。

→ **要成为「profile bundle」而不是「一个装了但没挂的包」，`package.json` 必须声明 `dsh.bundle.patch`。** 生产实例：`@local/dsh-clear-command`（`PROF/node_modules/@local/dsh-clear-command/package.json` 的 `dsh.bundle.patch: "./cordis.patch.yml"`）。

### 10.4 bundle 自带的 `cordis.patch.yml` 如何被应用

层顺序（`dsh-app-boot/src/profile.ts:678-712` `loadProfileDirectory` + `src/profile-context.ts:74-84` `readProfilePatches`）：

```
1. profile.layers   ← 按 dsh.profile.bundles 的顺序，每层 = 该包的 dsh.bundle.patch 文件（可多个路径）
2. profile 自己的 cordis.patch.yml            （PROFILE_PATCH_FILENAME，profile.ts:42）
3. $DSH_HOME/cordis.patch.yml                 （home 层）
4. 启动时 --patch <file> 覆盖                   （argv 顺序）
+ telemetry 补丁
```
全部**拼成一个扁平 patch 列表**，交给 loader-include 的 `applyEntryPatches` 单遍合成（`dsh-app-boot/src/index.ts:619-625`）。

- 加 bundle 层时的校验点：`dsh.bundle` 必须存在（`profile.ts:696-698`）；`platforms` 校验（`assertBundlePlatform`）；`evaluatePluginCompatibility`（`engines.dsh` 或 `@deepseek-ai/dsh*` 的 peer 版本）不满足 → 该 bundle 被**跳过**并列进 `skippedBundles`（`profile.ts:699-707`）。也就是说：**声明错版本的 peerDependencies 会让插件静默不加载**（启动诊断里能看到）。
- patch 文件必须是一个**顶层 YAML 数组**，每项是 patch entry（mapping），否则报 `<file> must be a top-level YAML array of loader patch entries`（`dsh-app-boot/src/index.ts:600-610`）。
- `!!js` 标签在 bundle patch 里可用（better-sidebar 用它做重复挂载守卫）。

**符号解析（能不能 `import '@deepseek-ai/...'`）**：`createRuntimeResolution` → `collectInstallationScopePackages`（`dsh-app-boot/src/profile.ts:373-421`）以 `installAnchor`（即 `@deepseek-ai/dsh/package.json`）为根，**BFS 遍历 dependencies + peerDependencies + optionalDependencies 全图**，装成一张包名→目录表，再由 `installRuntimeInterception`（`src/profile-resolution/resolver.ts:829+`）接管 ESM/CJS 解析。
→ 结论：**profile 插件可以 import 安装树里任何 `@deepseek-ai/*` 包（含 `dsh-home-paths`、`dsh-workspace`、`dsh-session-persistence`），即使本机 `PROF/node_modules/@deepseek-ai/` 是空目录。** 但裸 `node:fs` 之类更省事，且 `@local/dsh-clear-command` 就只用了 `node:crypto`。

---

## 11. 真机已有插件 `package.json` 实例（`dsh-better-sidebar@0.32.1`）

原始片段（`PROF/node_modules/dsh-better-sidebar/package.json`）：

**`dsh` 段（第 40-55 行）**
```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-slots",
      "@deepseek-ai/dsh-client-ui-conversation",
      "@deepseek-ai/dsh-client-ui-sidebar-right",
      "@deepseek-ai/dsh-client-modules"
    ],
    "platform": "web"
  },
  "manifestVersion": 1
}
```
**`exports` 段（第 15-39 行，节选）**
```json
"exports": {
  ".": { "types": "./lib/types/index.d.ts", "default": "./lib/index.js" },
  "./client": { "types": "./lib/types/client/index.d.ts", "default": "./lib/client.js" },
  "./icon": "./icon.svg",
  "./package.json": "./package.json",
  "./locale/*.json": "./locale/*.json"
}
```
**`files`（第 56-77 行，节选）**：显式列 `lib/index.js`、`lib/client.js`、`lib/client-*.js`、`lib/types/**/*.d.ts`、`src`、`cordis.patch.yml`、`detail`、`README*.md`、`LICENSE`、`icon.svg`、`locale/*.json`（**不含 scripts/*.sh 之类，也不含 `node_modules`**）。

**`peerDependencies`（第 78-102 行，节选；`icon` 在第 219 行）**
```json
"peerDependencies": {
  "@deepseek-ai/cordis": "^4.1.0",
  "@deepseek-ai/schemastery": ">=3.18.5 <4",
  "@deepseek-ai/dsh-client-locale": "^0.2.2-rc.2",
  "@deepseek-ai/dsh-client-ui-conversation": "^0.2.2-rc.2",
  "@deepseek-ai/dsh-client-ui-primitives": "^0.2.2-rc.2",
  "@deepseek-ai/dsh-client-ui-settings": "^0.2.2-rc.2",
  "@deepseek-ai/dsh-client-ui-sidebar-right": "^0.2.2-rc.2",
  "@deepseek-ai/dsh-client-ui-slots": "^0.2.2-rc.2",
  "@deepseek-ai/dsh-host-webserver": "^0.2.2-rc.2",
  "react": "^18.2.0", "react-dom": "^18.2.0"
  /* … 共 21 条 */
},
"peerDependenciesMeta": { "@huanlin/dsh-plugin-better-locale": { "optional": true },
                          "@deepseek-ai/dsh-client-ui-sidebar-right": { "optional": true } },
"icon": "./icon.svg"
```
注意：`@deepseek-ai/dsh-client-ui-primitives` **只在 peerDependencies**，不在 `dsh.client.inject` 里——因为它是 seed word，不是图行。ADR-0000 的这一条**正确**。

**`cordis.patch.yml`（完整，节选核心）**
```yaml
- insert:
    - id: better-sidebar
      name: 'dsh-better-sidebar'
      disabled: !!js "[...ctx.loader.entries()].some((e) => e.options.name === 'dsh-better-sidebar' && e.options.id !== 'better-sidebar' && !e.disabled)"
```
只插 **一行 Host**，没有 client 行。文件头注释还明确写了「If the profile still carries the old manual mount line… remove it before switching to the bundle channel **to avoid double-mounting (two Node halves, two sidebars)**」——但真实后果见 §2.2（client 半直接报错）。

**`lib/client.js` 形态（第 1-5 行）**
```js
window.__ModuleLoader__.load({
  id: "dsh-better-sidebar",
  factory: (require) => {
    var module = { exports: {} }; var exports = module.exports;
```
`require` 的实际调用只有 5 个：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/dsh-client-ui-primitives`（全部 seed word）。
它的 **cordis `inject`（第 37879-37886 行）是 service 名，不是包名**：
```js
const inject = ["slots", "sessions", "locale", "modules", "connection", "remote", "remote.session"]
```
注册切片（第 21273-21291 行）：
```js
ctx.slots.inject("shell.overlay", () => ctx.slots.register({
  name: "shell.overlay", id: "better-sidebar.context-diagnostics", order: 20,
  registrant: "dsh-better-sidebar",
  inject: () => ({ controller })
}, ContextDiagnosticsAlert))
```
（`registrant` 是作者自加的调试字段，**不在** `StoredEntry.options` 的已知字段里，属无害冗余。）

---

## 与设计文档不一致处

逐条对账。**A 类 = 事实错误（会误导实现）**，**B 类 = 行号/引用漂移（内容对但指错地方）**，**C 类 = 遗漏（文档没写但会影响实现）**。

### A 类：事实错误

1. **`ctx.locale.register(ns, {zh, en})` 在两个公开重载里不存在。**
   文档（0000 第 `locale 字符串` 节，引用 `LOC/src/client/index.ts:404`）：「一次调用传 dicts 对象……重载 `register(ns, localeOrDicts, dict?)`」。
   实际 `:404` 是**实现体签名**，不是重载。两个公开重载是 `(ns, dicts)`（**仅限 `LocaleNamespaceMap` 里已有的 ns**）与 `(ns, locale, dict)`。对 `deleteSession` 这种外部 ns，TS 下 2 参数调用会报「Expected 3 arguments」。纯 JS 下运行正常。
   → 处理：要么插件写纯 JS；要么 `declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { deleteSession: … } }`；要么照 better-sidebar 用 3 参数调两次（`lib/client.js:37902-37903`）。见 §6.1。

2. **`cordis.patch.yml` 为 client 插行的后果不是「加载两次」，而是 client 半整包加载失败。**
   文档（0000「避免」节）：「不要在 `cordis.patch.yml` 里为 Client 半插 `<pkg>/client` 行——会导致 client 模块被加载两次。」
   实际：`CM/src/index.ts:1089-1100` 抛 `client-modules: package <name> resolves from multiple active Loader sources: …; remove one entry`，client 半**一行都没注册**。见 §2.2。

3. **`ctx.connection.requestRejection(req) === void 0` 不等于「同源放行」。**
   文档（0000「鉴权 fence」、0002 后果、记忆文件「Host 路由」节）：「同源放行」。
   实际是「受信 Host/Origin（`isTrusted`）+ 已认证 browser 凭据或 API key」，返回 `401|403|undefined`（`rpc-host.ts:112-131`）。同源 fetch 通常能过，但语义是**认证**不是**同源**。桌面单用户场景结论不变，但描述要改，否则多 peer/远端场景会误判。见 §7.3。

4. **「会话目录两种历史命名并存：`<project>/<uuid>/` 与 `<project>/session-<uuid>/`」不成立。**
   文档（记忆文件「会话存储与删除」、ADR-0001 第 1 步要求两种都试）。
   实际：`sessionDir()` = `join(projectDir(root,cwd), encodeSegment(sessionId))`（`dsh-session-persistence-jsonl/src/format.ts:267-269`），`encodeSegment` 只做字符转义不加前缀；而 **sessionId 本身就带 `session-` 前缀**（`session-<uuid>`）。所以目录永远只有一个名字：`session-<uuid>`。本机实测亦如此。
   → 但**更好的做法是根本别拼路径**：用 `ctx.sessionPersistence.stat(id).location.path`（§9.3 方式 A），既避开命名假设也避开 `config.root` 被 patch 覆盖的风险。

5. **`SessionSummary.running` / `.blank` 的引用位置错了（且有两个同名不同形的 `SessionSummary`）。**
   文档（0000「禁用条件」、0004）：「`SessionSummary.running`（`snapshot.ts:88`）」。
   实际：`dsh-api-session-controller/src/client/contract/snapshot.ts:73-88` 是 **`SessionSnapshot`**（字段 `sessionId`），不是 `SessionSummary`。
   `useSessions` 返回的是**另一个** `SessionSummary`：`dsh-api-session-controller/src/client/sessions/service.ts:27-60`，字段是 **`id`**（不是 `sessionId`）加 `running`(:40)、`retainedBy`(:42)、`blank`(:50)，`byId` 在 `:65`。
   → `s.byId[sessionId]?.running` 的写法**是对的**（对应 client store 版），只是引用该改成 `client/sessions/service.ts:27-65`。

6. **`dsh.client.inject` 的下游语义引用位置 `manifest.ts:47-50` 也对，但它不是解析点。**
   `manifest.ts:47-50` 是 `WebBootEntry` 的 `inject` 文档（「Package-name dependency edges used for factory arrival and plugin composition」），内容对但**不是** `dsh.client` 的解析点。真正的 `dsh.client` 校验在 `manifest.ts:173-195`（`parseDshClient`），读取决策在 `index.ts:891-919`（`resolveMeta`）。

7. **行内按钮「视觉上不是绝对最后 / 会与 `⋯` 相邻，位置不确定」——实际位置是确定的：在 `⋯` 之后，且是整条 strip 的最后。**
   文档（0000「UI 入口」重要说明、ADR-0003）：承认不确定。
   实际 `Rows.tsx:748-760`：`contextMenu.button`（即 `⋯`）**先渲染**，然后才是 `rowQuickActions` 里的 `row.action` slot（archive 100 → pin 200 → 我们的 300）。所以 `order: 300` = strip 最右侧元素，无歧义。

### B 类：行号/引用漂移（内容正确）

| 文档引用 | 实际 | 说明 |
|---|---|---|
| `system.ts:209-224` 报 `loaded without registering` | 实际 `:209` 是 `arrive()` 开头，失败文案在 **`:224`**，外层 `could not load` 在 **`:246`** | 区间基本对，尾行 `:224` 才是关键 |
| `system.ts:313` `registered.factory(this.makeRequire(...))` | **`:313`** ✔ | 完全正确 |
| `system.ts:384-392` `cannot resolve … not a seed word` | 实际 `:392`（`import()` 分支）；**`require()` 分支的文案在 `:336`**，措辞不同 | 两个不同错误，文档只提了一个 |
| `dsh-workspace/src/index.ts:389-393` waterfall | **`:389-393`** ✔ | 完全正确 |
| `dsh-workspace/src/index.ts:399` archive 清 pin | **`:399`** ✔ | 完全正确 |
| `:420` unarchive / `:425` 幂等 / `:477` unpin / `:485` 幂等 | **全部 ✔** | — |
| `:413-415` / `:469-471` 「不校验存在」注释 | 实际注释在 **`:412-417`** 与 **`:469-471`** | 基本对 |
| `dsh-host-webserver/src/index.ts:445-451` 重复注册抛 | **`:445-455`**，抛在 **`:447-449`** | ✔ |
| `dsh-client-locale/src/client/index.ts:586-587` 官方内部用法 | **`:586-587`** ✔ | 完全正确 |
| `dsh-client-ui-session/src/client/index.ts:157-164` GlobalStandardProps | **`:156-164`** | ✔ |
| `WorkspaceBrowser.tsx:325-329` `retainedBy.mainView` | **`:325-327`** ✔（另有 `:715/:842/:971`、`tree.ts:40`、`shortcuts.ts:67` 同样写法） | ✔ |
| `WorkspaceBrowser.module.css:601-603` `.deleteAction` | 未能核实（CSS module 已编译进 bundle，源码里是 `browserCss.deleteAction`，见 `ArchiveSession.tsx:105`） | CSS 行号不可靠，语义可用 |
| `dsh-better-sidebar/package.json:44-52` `dsh.client.inject` | 实际 **`:44-53`**（`"client"` 在 :44，数组 :45-51，`platform` :52） | ✔ |
| `dsh-better-sidebar/package.json:85` primitives peer | 实际 `"@deepseek-ai/dsh-client-ui-primitives"` 在 **`:86`**（`peerDependencies` 块 :78-102） | 差 1 行 |
| `ArchiveSession.tsx:30` 不允许返回 `null` | **`:30`** ✔ | ✔ |
| `ArchiveSession.tsx:100-112` 确认框按钮 | **`:100-112`** ✔ | ✔ |
| `slots.ts:93-99` SessionRowOwnerProps | **`:93-100`** ✔ | ✔ |
| `slots.ts:510-515` / `:503-519` 三段式 | 实际 `SessionArchiveConfirmProps` 在 **`:511-516`**；`RowToastProps` `:518-523`；`WorkspaceBrowserProps` `:525-538` | 区间整体对 |
| `snapshot.ts:88` blank | 见 A5 | — |
| `dsh-workspace/src/index.ts:115` `unarchiveSession` 公开 | 实际在 **`:420`**（`:115` 是 `ArchiveSessionOptions` 附近） | 引用错行，结论对 |
| `dsh-session-query-sqlite/src/index.ts:423-425` 对账自清 | 未核（超出本次核查范围），但与「不手工清索引」的结论无关风险 | 建议实现者忽略引号、遵守结论 |
| `dsh-workspace/src/spec.ts:48-49` | 本机 `WK/` 下无 `src/spec.ts`；集合字段实际在 `src/types.ts` + `index.ts:360/439` | 文件不存在 |
| `dsh-cordis-host-runner/src/index.ts:774` `run.handlers.get(method)` | 未核（动态包路径，本插件不涉及） | 不影响 |

### C 类：文档遗漏（实现必须知道）

1. **`dsh.client` 还有 `external` 和 `immediately` 两个字段**（`manifest.ts:180-194`）。本项目用不到，但别在写 package.json 时以为是非法字段。
2. **`priority` 千万别自己传**（`slot-catalog.ts:75`）：facade 会自动分配，且**低于所有 shipped entry**——在 single/keyed slot 里等于覆盖官方 UI。list slot 无影响，但传了是隐患。
3. **`sidebar.workspaces.session.row.action` 的 `declaredBy` 是 `sidebar.workspaces`**（catalog `:5557`），不是 root。所以注册**必须** `ctx.slots.inject('sidebar.workspaces.session.row.action', …)`，不然 owner 还没挂载时注册会抛。`shell.overlay` 则挂在 `root`（由 ui-layout 的 AppFrame 声明），同样要 `inject` 等待。
4. **`PropsLocale` 的 `t` 只在你传了 `locale` 注册选项时才来**。不传 → 组件没有 `t`（类型上也退化成 `object`）。官方 archive 项正是靠 `locale: NS` 拿到 `t`（`WS/src/client/index.ts:392-393`）。
5. **`PropsHooks` 的键名变换是 `use${Capitalize(name)}`**（`api-catalog.ts:812`）。`hooks: { archived }` → `useArchived`；`hooks: { archiveRequest }` → `useArchiveRequest`；下划线/连字符会出怪名，用 camelCase。
6. **`ctx.contextMenus.register` 返回 disposer，必须 `ctx.effect(() => …, 'label')` 包住**（官方全部如此，`context-menus.tsx:26`）。`notify` 的 `action.run()` 被拒会再弹 `failureLabel`（`CU/src/client/index.ts:78-80`）。
7. **`dsh.bundle.patch` 是「成为 profile 层」的硬门槛**：不声明 → 装了也不挂（`operations.ts:107-111` 只 warning）。本机 `@local/dsh-clear-command` 是最小可用模板（`package.json` + `cordis.patch.yml` + `index.js`，无 locale 目录、无 client 半）。
8. **`--profile desktop` 只能由桌面自带 `dsh` 载体执行**（`args.ts:83-87`、`198`；`dsh-desktop-host/lib/cli.js:57`；`runtime/cli/bin/dsh.cmd`）。ADR-0000「安装」节写的 `dsh plugin --profile desktop add link:…` 命令**形式正确**，但要强调必须用安装目录里那个 `dsh.cmd`，且 profile 已被桌面初始化过、桌面已完全退出。
9. **peerDependencies 声明不对会让插件静默不加载**（`profile.ts:699-707` → `skippedBundles`），启动诊断里才看得到。写 `^0.2.2-rc.2` 这类 caret 是安全的（当前 runtime `0.2.2-rc.3` 满足）。
10. **更好的删除定位方式**：`ctx.sessionPersistence.stat(id)` → `undefined` 即不存在（= `SESSION_NOT_FOUND` 的权威判定）；`snapshot.location.path` 即落盘文件绝对路径，`dirname` 就是会话目录。比「遍历所有 project 目录 × 两种命名」稳得多，也自动排除「空白未落盘会话」。（`dsh-session-persistence/src/index.ts:203`、`:62-67`、`errors.ts:85-90`）
11. **`workspaceRegistry` 的清理语义 ADR 描述准确**，但补一条：`archiveSession` 会校验会话存在并抛 `WorkspaceUnknownSessionError`；`unarchiveSession`/`unpinSession` **不校验**——所以顺序真无所谓，且可以用它们兜底清理已删文件的孤儿 id。
12. **`@deepseek-ai/*` 在 profile 里可 import**（安装树 BFS + runtime 拦截解析，`profile.ts:373-421`、`resolver.ts:829+`），即使 `PROF/node_modules/@deepseek-ai/` 是空目录。但最省事的是只用 `node:*` 内置模块（照 `@local/dsh-clear-command`）。

## 12. 客户端会话列表的刷新（2026-11-19 实测补充）

**结论：Host 直接改磁盘不会让侧栏重列，必须显式调用 `ctx.sessions.refresh()`。**

- 客户端会话列表的唯一来源是 `ctx.sessions.list`（`ObservableSnapshot<SessionListState>`，`dsh-api-session-controller/src/client/contract/sessions.ts:51`）。
- 重新取列表只有一条路：`ISessions.refresh()` → `SessionManager.refreshList()` → 向 Host 发一次 `session.list` RPC（`client/sessions/service.ts:372-373`、`client/sessions/manager.ts:394-395`，单飞）。
- Host 的 `list` 读磁盘（持久化层），所以**文件删掉后只要 refresh 一次，行就会消失**；不 refresh 则快照一直是旧的，行会留在侧栏。
- 因此任何绕过会话服务、直接操作磁盘的插件，删除/移动/新建会话之后都要自己 `refresh()`（本插件：删除成功后、以及收到 `SESSION_NOT_FOUND` 时各调一次，后者用于清掉上一次遗留的幽灵行）。
- 对照：官方 `archiveSession` 走 registry 写入 + 事件，客户端本来就有反应式来源，所以它不需要手动 refresh。这是「直接改磁盘」这条绕路必须自己补的成本。
