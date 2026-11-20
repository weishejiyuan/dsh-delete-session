# 3. 删除入口同时覆盖行内按钮和右键菜单

日期：2026-11-19
状态：已接受

## 背景

用户要求两个入口：①会话栏右侧的永久删除按钮；②右键菜单的永久删除项。两者都要，且必须和已装插件共存。

## 决策

| 项 | 决策值 | 依据 |
|---|---|---|
| 行内按钮 slot | `sidebar.workspaces.session.row.action` | 官方行内按钮区 |
| 行内按钮 order | `300` | slot 注册顺序：archive=100、pin=200 之后。视觉上可能与官方内联 `⋯` 菜单相邻，不是视觉绝对最后 |
| 行内按钮视觉 | 纯图标 + Tooltip + aria-label | 行内空间窄，与官方 archive/pin 按钮一致 |
| 右键菜单 id | `session.delete` | 菜单项唯一标识（menu id，不是图标 key） |
| 右键菜单 order | `700` | pin=100、rename=200、fork=300、id=450、archive=600 之后 |
| 右键菜单标志位 | `danger: true`, `separatorBefore: true` | 防止误点，视觉分隔 |
| 图标 slot key | `session.delete` | 注册到 `contextMenu.icon` slot，与 menu id 同名但不同命名空间 |
| 图标来源 | `@deepseek-ai/dsh-client-ui-primitives` 的 `IconTrashOutlineRegular` | 官方 trash 图标，语义匹配 |
| Locale namespace | `deleteSession` | 只注册 zh+en |
| 确认框 slot | `shell.overlay` | 全窗口浮层，不同插件用不同 id 追加不冲突 |
| 确认框按钮顺序 | 「永久删除」在右（红色文字，`variant="outline"`）、「取消」在左（次级） | 与官方 `SessionArchiveConfirmDialog` 完全一致 |
| 确认框危险色实现 | `Button variant="outline"` + 内联 `style={{ color: 'var(--dsw-alias-state-error-primary)' }}` | 官方用 CSS module 类 `.deleteAction` 达到同样效果（`WorkspaceBrowser.module.css:601-603`）；我们无法 import 该 CSS module，改用内联样式等价实现 |
| 已归档行（Q20） | **显示且可删** | 归档只是软隐藏；否则要「先取消归档再删」两步 |
| 空白新会话行（Q21） | **不显示** | 未落盘，无目录可删；`onClick` 只会报 SESSION_NOT_FOUND。实现上返回 `null`，与官方 `ArchiveSessionRowButton` 的「不允许就返回 null」一致 |
| Host 路由 | `POST /delete-session/api/delete` | 单 method，无版本前缀 |
| 路由返回体 | `{ ok: boolean, code: string, message?: string }` | code 枚举：`OK` / `SESSION_ACTIVE` / `SESSION_NOT_FOUND` / `DELETE_FAILED` |
| 权限门 | 不接 `ctx.remoteAccess` | 桌面单用户 owner 全放行，零收益复杂度 |

## 理由

- `order: 300` 是官方 action slot 注册项（archive=100、pin=200）之后的安全位置。行内还有一个官方内联渲染的 `⋯` 更多菜单按钮（不通过 slot 注册），它不受 order 控制。删除按钮视觉上会与 `⋯` 按钮相邻，这是刻意的取舍——300 保证了与 archive/pin 的语义邻近性，破坏性操作聚集出现，符合用户预期。v1 指南误写为 300 为右键菜单 order，会插到 fork 前面，已修正。
- `danger` 让浏览器和主题都按破坏性操作渲染，比单纯加图标更语义化。
- `shell.overlay` 是 list 语义，不同插件用不同 id 追加不冲突；行菜单 dismiss 后 overlay 里的对话框仍存活，适合做确认流程。
- `separatorBefore` 在删除项上方加分隔，和归档这类非破坏性操作视觉分开。
- 纯图标 + Tooltip 与官方行内按钮一致；用户 hover 500ms 就能看到「永久删除」说明。
- `IconTrashOutlineRegular` 是官方 trash 图标，语义精确匹配「永久删除」。
- 确认框按钮顺序与官方一致：「取消」在左、「永久删除」在右。危险感不靠实心红块制造，而靠红色文字 + 明确文案 + 副文案「此操作不可撤销」三重提示——官方 archive 确认框就是这么做的（`ArchiveSession.tsx:100-112`），照抄可保证与 DSH 其余对话框视觉统一。
- **已归档行也显示删除按钮（Q20）**：归档是软隐藏，会话文件仍占磁盘。若归档行不给删除入口，用户想清理就得「先取消归档 → 再删」两步，把一件直接的事拆成两件。官方 archive 按钮在归档行会变成 unarchive，说明官方也认为归档行需要操作入口。
- **空白新会话行不显示删除按钮（Q21）**：`blank` 行尚未落盘，没有会话目录，删除只会得到 `SESSION_NOT_FOUND`。给一个必然失败的按钮是坏体验。判定方式：行内按钮通过 `useSessions` 查 summary 的 `blank` 标志；右键菜单通过 `observe`/`resolve` 读同一标志后返回 `[]`（官方 `archive` 菜单项在不允许时也返回 `[]`）。
- 不接权限门：桌面单用户场景下 owner 全放行，接权限门是零收益的复杂度。将来多 peer 再补。

## 后果

- 两个入口共享同一个 `requestDelete(sessionId)` 和同一个 `deleteTarget` store。
- 新装插件若也用 `order: 700`，会同序排列，由 Loader 注册顺序决定前后；选 700 只是当前最优解，不是永久预留。
- 若 DSH 未来新增 order > 700 的官方项，需要再核对一次是否要调整。
- 不接权限门意味着：将来若某个 peer 对「会话可见」但「不应可删」，本插件拦不住。这是接受的取舍。
- 行可见性矩阵不在本文件重复维护——唯一来源是 `0000-naming-conventions.md` 的「行可见性矩阵」节（含当前会话、运行中会话、已归档、空白行、面板激活态五种状态）。本文件只记录 Q20（归档行可删）与 Q21（空白行不显示）这两条决策本身；Q24 的运行中置灰决策见 ADR-0004。