# 人工验收清单（**尚未执行**）

本清单是本轮（ticket 06）的交付物之一，**一条都没有执行过**。本轮验证策略是代码侧收尾 + 静态审计：不安装插件、不重启 DSH、不做浏览器走查（用户 2026-11-19 决策 A）。因此下面任何一条都不得被引用为「已通过」。

代码侧已有 **64 条自动化测试**覆盖逻辑层（`npm test`，64/64 通过）：Host 端点的四步删除、四个业务 code 与四道守卫 code、目录围栏、registry 清理次数；Client 端的槽位注册、可见性矩阵、确认框交互、失败文案映射。每条验收项下面的「① 自动化已覆盖」列指出它对上了哪个测试；「② 仍需人工确认」列写的是只有真机才能看到的观察点；「③ 前置步骤」列是到达该观察点之前的操作。

配套证据：冲突复核见 [`docs/conflict-audit-result.md`](./conflict-audit-result.md)，安装/回滚见 [`README.md`](../README.md)。

## 0. 前置准备（每轮走查开始前执行一次）

| 步骤 | 操作 | 预期 |
|---|---|---|
| 0.1 | 完全退出 DSH（托盘 / 任务管理器确认没有 `DeepSeek Harness.exe`） | 进程列表里没有 DSH |
| 0.2 | 在任意终端执行 `dsh plugin --profile desktop add link:E:\develop\dsh-plugins\dsh-delete-session` | exit 0；`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 末尾出现 `@local/dsh-delete-session` |
| 0.3 | 启动 DSH | 侧栏正常渲染，无插件加载错误 |
| 0.4 | 造数据：3 个普通会话（有消息）、1 个已归档会话、1 个还没发消息的空白新会话 | 侧栏可见 |
| 0.5 | 打开 DevTools 控制台（`Ctrl+Shift+I`） | 无红色报错 |

后续每条走查都在这个状态下进行。任何一条不通过时，记录：操作序列、实际看到的现象、控制台输出、时间点。

## A. spec 的 13 条人工验收清单

| # | 验收项（spec 原文） | ① 自动化已覆盖 | ② 仍需人工确认的观察点 | ③ 前置步骤 |
|---|---|---|---|---|
| 1 | 会话行 hover 出现 trash 图标按钮，Tooltip 显示「永久删除」 | `client-factory.test.js`「行内按钮是纯图标 + 500ms Tooltip + aria-label」「apply 注册中英字典、行内按钮 slot（order 300）、shell.overlay 确认框与菜单图标 key」；`row-visibility.test.js`「普通会话可点，提示「永久删除」」 | 图标外观是否为 trash 轮廓；hover 后是否**恰好约 500ms** 才出 Tooltip；Tooltip 出现在按钮下方偏右（`side: bottom, align: end`）且不被侧栏裁切 | 0.1–0.5；鼠标停在一个普通会话行上 |
| 2 | 右键菜单底部出现「永久删除」项，带分隔线与危险色 | `context-menu.test.js`「普通会话：一项、带图标/danger/分隔线、无 afterContent 与 commandId、可点」「菜单项经 ctx.effect 包裹注册为 {id: session.delete, target: session, order: 700}」「图标 key 注册在 contextMenu.icon keyed slot，组件来自 primitives」 | 该项是否真的排在「归档」之下并带一条上方分隔线；红色是否为官方危险色；trash 图标是否正常渲染（keyed icon slot 未命中的话会空出位置） | 0.1–0.5；在普通会话行上右键 |
| 3 | 当前会话的入口置灰，Tooltip 说明原因 | `row-visibility.test.js`「当前会话（mainView > 0）置灰，提示「不能删除当前会话」」「只有 mainView 引用判定当前会话：侧栏引用 / 选中态行仍可点」；`context-menu.test.js`「当前会话：一项、置灰、文案「不能删除当前会话」」 | 当前会话行内按钮的实际灰阶是否可辨（`opacity: 0.4`）；置灰状态下点击完全无反应；菜单项同样置灰 | 0.1–0.5；停留在某个会话里，hover/右键**该会话自己的行** |
| 4 | 运行中会话的入口置灰，任务结束后自动恢复 | `row-visibility.test.js`「运行中会话置灰，提示「会话正在运行，请先停止」」；`context-menu.test.js`「运行中会话：一项、置灰、文案「会话正在运行，请先停止」」 | 让会话 A 生成回复，切到会话 B 观察 A 行是否置灰；A 结束后是否**无需刷新**自动恢复可点（依赖 `useSessions` 的响应式订阅，测试里只验证了 selector 的取值） | 0.1–0.5；向会话 A 发一条长回复请求，立刻切到会话 B |
| 5 | 点入口弹出确认框，含会话标题与不可撤销说明 | `confirm-dialog.test.js`「确认框显示标题与含会话标题的不可撤销说明，取消在左、永久删除在右」；`client-factory.test.js`「点击按钮只打开确认请求，不发请求、不弹提示」 | 确认框的层级是否在全窗口浮层之上（不被侧栏或面板遮挡）；长标题是否截断/换行正常；`Esc` 与点遮罩能否关闭 | 0.1–0.5；点普通会话行内按钮 |
| 6 | 确认框「取消」在左、「永久删除」在右，后者为红色文字描边样式 | `confirm-dialog.test.js`「「永久删除」是描边样式配红色文字，不是实心红块」「英文界面下确认框的标题、说明与两个按钮文案都正确」 | 视觉效果：描边 + 红字（不是实心红块）、与官方归档确认框并排对比是否一致；按钮间距与对齐 | 同上 |
| 7 | 点取消无任何副作用、无提示 | `confirm-dialog.test.js`「点取消：关框、store 清空、不发请求、不弹提示」「Esc / 点遮罩（onClose）等同于取消，不执行删除」 | 取消后会话仍在侧栏、磁盘目录未动、无 toast、无控制台报错；重复开关确认框多次仍无副作用 | 0.1–0.5；点入口→取消，重复 3 次 |
| 8 | 确认后会话从侧栏消失、出现成功提示 | `confirm-dialog.test.js`「点永久删除：恰好一次 POST，成功后关框并提示「会话已永久删除」」「请求进行中：按钮文案切「正在删除…」、两按钮禁用、连点不产生第二个请求」 | 该行是否**立即**从列表消失（由 DSH 自身的 sessions 快照驱动，插件不主动刷新）；toast 文案是否为「会话已永久删除」；连续点击是否只删除一次 | 0.1–0.5；删除一个可牺牲的普通会话 |
| 9 | 删除后磁盘目录消失、搜索不到 | `host-api.test.js`「删除普通会话：目录与日志一起消失，归档与置顶各清一次」「从未归档、从未置顶的会话：两个清理照常各调一次且不报错」 | 磁盘目录真的消失（见 §C.2 的取证命令）；搜索该会话标题无结果（见 §C.2）；置顶区/归档区无该会话的孤儿行 | 执行 §C.2 |
| 10 | 已归档会话可正常删除 | 部分覆盖：`host-api.test.js`「从未归档、从未置顶的会话：两个清理照常各调一次且不报错」只证明清理调用对未归档会话也安全；可见性矩阵不区分归档，行内按钮与菜单项走同一条规则（`row-visibility.test.js`「普通会话可点，提示「永久删除」」） | 归档区里的会话行**确实**也出现删除入口且可点；删除后归档集合里不留该 id（侧栏不出现点不开的孤儿行） | 0.1–0.5；先归档一个会话，再在归档区删它 |
| 11 | 空白新会话行没有删除入口 | `row-visibility.test.js`「空白会话行不渲染按钮」；`context-menu.test.js`「空白会话行：不出现该项（返回空数组，不是置灰）」 | 新建但没发消息的会话行既无按钮、右键菜单里也无该项（而不是置灰的项） | 0.1–0.5；新建一个会话、不发消息，hover 与右键该行 |
| 12 | 面板激活态下普通会话仍可删除 | `row-visibility.test.js`「面板激活态下不判定当前会话，mainView 行仍可点」「面板激活态下运行中行仍置灰」；`context-menu.test.js`「面板激活态下 mainView 行不置灰（当前会话判定让位于运行中判定）」 | 打开右侧面板（diff / 文件树等）后，正在主视图里的那个会话行是否变成可点；此时删除成功 | 0.1–0.5；打开右侧面板，hover 当前会话行 |
| 13 | 禁用插件后入口全部消失，DSH 其余功能正常 | 无自动化覆盖（这是打包/装载层行为） | 全部见 §C.3 | 执行 §C.3 |

## B. ticket 06 的收尾项

| # | 验收项 | ① 自动化已覆盖 | ② 仍需人工确认的观察点 | ③ 前置步骤 |
|---|---|---|---|---|
| B1 | 运行中被拒时提示「会话正在运行，请先停止」 | `host-api.test.js`「活动闸门非空返回 409 SESSION_ACTIVE，在任何文件操作之前中止」；`confirm-dialog.test.js`「409 SESSION_ACTIVE：框保持打开、不弹提示、框内显示「会话正在运行，请先停止」」 | 真机被拒后：确认框留在原地、框内红字、无成功 toast、会话仍在侧栏 | §C.1 |
| B2 | 会话不存在时提示「会话不存在，可能已被删除」 | `host-api.test.js`「未落盘的 pending 会话（快照无 location）返回 404，磁盘与 registry 都不动」「持久化层查不到会话（stat 返回 undefined）返回 404 SESSION_NOT_FOUND」；`confirm-dialog.test.js`「SESSION_NOT_FOUND / DELETE_FAILED / 未知码各自映射到对应文案」 | 真机复现方式同 §C.1 的「制造不一致」：打开确认框后，用另一个窗口/终端删掉该会话目录，再点永久删除 → 框内显示「会话不存在，可能已被删除」 | §C.1 的降级路径 |
| B3 | 删除失败时提示中带上具体原因，而不是只有「删除失败」四个字 | `host-api.test.js`「递归删除抛错返回 500 DELETE_FAILED 并带上真实原因」「stat 定位到的目录在 sessions 根之外返回 500 DELETE_FAILED，不删」；`confirm-dialog.test.js`「SESSION_NOT_FOUND / DELETE_FAILED / 未知码各自映射到对应文案」「网络异常：框内显示「删除失败」加原始消息」 | 真机制造文件系统失败：删除前用另一个进程占用目录内的文件（Windows 上例如用编辑器占住 `session.v4.jsonl.zstd`），点永久删除应看到「删除失败 — EBUSY…」这类**带原因**的句子 | 0.1–0.5；占用文件后删除该会话 |
| B4 | 删除成功时提示「会话已永久删除」 | `confirm-dialog.test.js`「点永久删除：恰好一次 POST，成功后关框并提示「会话已永久删除」」 | toast 的实际文案、出现位置、是否自动消失 | 0.1–0.5 |
| B5 | 服务端兜底路径可验证：客户端显示可点但存在子 agent/后台任务时强行删除被拒绝并给出运行中提示 | 逻辑层：`host-api.test.js`「活动闸门非空返回 409 SESSION_ACTIVE…」（任意活动提供方返回非空即拒）；UI 层：无（客户端只看轮次状态，spec 已声明这是两层判定的必然窄窗） | 全部见 §C.1 | §C.1 |
| B6 | 异常路径下不存在「部分成功」：任一目录删除失败时整体报失败，不报成功 | `host-api.test.js`「递归删除抛错返回 500 DELETE_FAILED 并带上真实原因」（断言：返回 500、磁盘目录保持原样、`unarchiveSession`/`unpinSession` 各 0 次、无成功码） | 真机用 B3 的占用手段触发后：无成功 toast、会话仍在侧栏、registry 未清新（会话仍在归档/置顶集合里） | 同 B3 |
| B7 | 删除后不自动切换到其他会话，当前视图状态由 DSH 自行处理 | 无自动化覆盖；静态证据：`client/client.js` 全文不含任何跳转/选中类调用，请求成功后只做 `closeDeleteRequest()` + `contextMenus.notify(...)`，`ctx.layout` 只读取 `panelInfo` 快照用于可见性判定 | 删除当前正**在侧栏可见但未打开**的会话后，视图不发生跳转；不出现空白页或报错 | 0.1–0.5；确保要被删的会话不是当前会话 |
| B8 | 删除后没有「撤销」入口 | `confirm-dialog.test.js`「两个 locale 字典覆盖全部 key，中英都非空且既有文案未改」——该测试把字典 key 集**精确断言**为 12 个（`label.*` / `confirm.*` / `cancel` / `close` / `deleted` / `sessionActive` / `sessionNotFound` / `deleteFailed`），不含任何撤销类 key；`confirm-dialog.test.js`「点永久删除…」断言成功路径只发出**一条**提示 `{ text: '会话已永久删除', success: true }`（无第二个提示、无按钮参数） | toast 上没有按钮/可点区域；右键菜单与行内均无撤销入口 | 0.1–0.5 |
| B9 | 删除后该会话在搜索中不再出现（DSH 索引对账自动完成，插件未手工介入） | `host-api.test.js`「删除普通会话：目录与日志一起消失，归档与置顶各清一次」证明插件只删目录 + 清两个集合，**不触碰查询索引**（Host 侧无任何 sqlite/索引调用） | 全部见 §C.2 | §C.2 |
| B10 | 按 spec 的验收清单逐条走查并留下结果记录 | 本文件 A 段 + D 段 | 逐条勾选，未勾项如实记为「未执行」 | — |
| B11 | 冲突复核：两个入口、图标、locale 命名空间、路由前缀均未与已装插件抢占同一标识 | **静态审计已完成**：见 `docs/conflict-audit-result.md`（6 个标识 × 16 个 bundle，命中数与命令原文齐备；唯一命中为 memory 插件内的同名私有函数，不注册 locale） | 装好启动后补一条运行确认：控制台与启动日志无「already registered」/「already has locale」类报错；行内按钮的 trash 图标正常显示（图标 key 命中） | 0.1–0.5 |
| B12 | 禁用或移除插件后，行内按钮与右键菜单项全部消失，无残留浮层或孤儿菜单 | `confirm-dialog.test.js`「确认框未打开时 shell.overlay 条目返回 null，不常驻空浮层」证明无请求时 overlay 不渲染任何东西 | 全部见 §C.3 | §C.3 |
| B13 | 禁用插件后 DSH 其余功能（归档、置顶、重命名、fork、搜索）全部正常 | 无自动化覆盖 | 全部见 §C.3 | §C.3 |
| B14 | 禁用插件后不需要清理任何 DSH 持久化数据即可回到装之前的状态 | 静态证据：插件不写配置文件、不建 DB、不改 DSH 持久化结构；唯一的写操作是被删会话目录的递归删除与宿主 registry 的 `unarchiveSession`/`unpinSession`（都作用于「已被删掉的会话 id」，本身随会话消失而收敛）。安装只改 `~/.dsh/profiles/desktop/` 的 `package.json` / `pnpm-lock.yaml` / `node_modules` 链接，`remove` 会连 `dsh.profile.bundles` 条目一起回滚 | 全部见 §C.3 | §C.3 |
| B15 | 行内还有官方内联渲染的「更多」按钮，确认删除按钮与它的相邻关系在视觉上不导致误点 | 静态证据（`dsh-client-ui-workspace/src/client/rows/Rows.tsx:751-758`）：行操作条结构是 `[官方的「…」触发器(contextMenu.button)] [rowQuickActions: archive(100), pin(200), delete-session(300)]`，本插件按钮是这一组的**最右**一个，与「…」之间始终隔着 archive / pin | 视觉确认：trash 按钮与「…」之间有足够的间距与分隔；hover 到 trash 上不会误触「…」的菜单；不会因为 order 300 被挤到行外或换行 | 0.1–0.5；把鼠标在行尾区域缓慢移动，注意是否弹出错误菜单 |

## C. 三个特殊步骤的复现方法

### C.1 服务端兜底路径（客户端显示可点，服务端仍拒绝）

背景（spec「已知残余窗口」）：客户端只读会话的轮次状态 `running`，窄；服务端问的是宿主的全部活动提供方（子 agent、后台 job、活动 schedule），全。所以存在一个「按钮可点、点完被 409 拒绝」的窗口——这正是要被验证的兜底。

**制造场景**：

1. 打开会话 A，让它起一个**活到主轮次结束之后**的后台工作。任选其一（看当前 DSH 有哪些能力可用）：
   - 让 agent 起一个子 agent（agent team / 委派）并让子 agent 继续跑；
   - 让 agent 起一个后台 job（例如一条长时间运行的命令），并保持它未结束；
   - 在该会话上建一个**活动中的 schedule**（定时任务），让它在待触发状态。
2. 立刻切到侧栏里的**另一个会话 B**（停在 B，不要停在 A——当前会话的入口会因「不能删除当前会话」而置灰，看不到兜底路径）。
3. 观察会话 A 行内的删除按钮：主轮次已结束 → `running` 为假 → 按钮**可点**（预期如此）。
4. 点它 → 确认框 → 点「永久删除」。

**预期**：确认框不关闭；框内出现红色「会话正在运行，请先停止」；无成功 toast；A 仍在侧栏；磁盘目录仍在。
**反证**：把子 agent / 后台 job / schedule 停掉后再走一遍，应删除成功并出现「会话已永久删除」。

**如果造不出这个窗口**（活动在 UI 上总会让 `running` 变真），退一步只验证**服务端闸门**本身：右键会话 A → 官方菜单里的「复制会话 ID」，然后在 DevTools 控制台执行

```js
await fetch('/delete-session/api/delete', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ sessionId: '<粘贴会话 ID>' }),
}).then(async (r) => ({ status: r.status, body: await r.json() }))
```

在一个仍有活动的会话上，预期得到 `{ status: 409, body: { ok: false, code: 'SESSION_ACTIVE', message: '会话正在运行，请先停止' } }`。这条只证明服务端闸门生效，UI 层的可点状态仍需上面的步骤 3–4 才算验证完整。

### C.2 「删除后搜索不到」怎么来的、怎么观察

**机制**：搜索走的是 DSH 自己的会话查询索引（`@deepseek-ai/dsh-session-query-sqlite`），它是**对账式**的：观察循环发现某个会话在持久化快照里消失后，会在下一次对账事务里 `DELETE FROM persisted_sessions / persisted_docs` 把该 id 的行丢掉（`dsh-session-query-sqlite/src/index.ts:456,465,571-580`）。**本插件不碰这个索引**——它只做「活动检查 → 递归删目录 → 清 archive → 清 pin」四步，手工清索引会与对账机制对抗（spec「索引不手工清理」）。

**观察方式**：

1. 删掉一个标题**唯一、好记**的会话（例如把它重命名为 `acceptance-0701`）。
2. 在搜索框里搜 `acceptance-0701`：预期无结果。索引对账有间隔，如果第一次搜索仍看到该会话，切到别处/重开搜索再搜一次；仍持续出现即为真问题，记录时间点与搜索结果。
3. 磁盘取证：

   ```bash
   ls "$HOME/.dsh/sessions" | grep -F "<会话 ID>"
   ```

   预期无输出（目录已被删除）。Windows PowerShell 等价：`Get-ChildItem "$env:USERPROFILE\.dsh\sessions" | Where-Object Name -like "*<会话 ID>*"`。

4. 归档区与置顶区各看一遍：不应出现该会话的孤儿行。

判断标准：搜索无结果 + 目录消失 + 无孤儿行，三者同时满足才算通过；其中「搜索无结果」由 DSH 对账负责，若它不收敛而另外两项正常，属于 DSH 索引侧问题，需记录现象而不是在插件侧补救。

### C.3 禁用 / 移除插件之后

**步骤**：

1. 完全退出 DSH（托盘退出；任务管理器里确认 `DeepSeek Harness.exe` 已结束）。
2. 执行 `dsh plugin --profile desktop remove @local/dsh-delete-session`。
3. 确认装载层已回滚：`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里不再有 `@local/dsh-delete-session`，`~/.dsh/profiles/desktop/node_modules/@local/dsh-delete-session` 链接消失。（`dsh-plugin-manager` 的 `reconcile()` 会把「已不是 dependency」的 bundle 从 `dsh.profile.bundles` 里剔除，见 `src/operations.ts:100-126`。）
4. 启动 DSH。

**应观察到**：

| 观察点 | 预期 |
|---|---|
| 会话行内 | 没有 trash 图标按钮；行尾只剩官方的「…」触发器与 archive / pin |
| 右键菜单 | 没有「永久删除」项，也没有它上方的分隔线 |
| 浮层 | 没有任何残留的空浮层/幽灵对话框；`Esc` 与点遮罩行为正常 |
| 归档 | 右键「归档」正常，归档区正常 |
| 置顶 | 右键「置顶/取消置顶」正常 |
| 重命名 | 右键「重命名」正常，对话框正常 |
| fork | 右键「fork」正常 |
| 搜索 | 搜索正常返回结果 |
| 控制台 | 无与本插件相关的红色报错 |
| 持久化数据 | **无需清理任何东西**：插件没有配置文件、没有独立数据库，也不改 DSH 的持久化结构；`~/.dsh/sessions` 里除**你主动删除过**的会话外，其他会话完好 |

**替代移除方式**：直接删掉 `~/.dsh/profiles/desktop/node_modules/@local/dsh-delete-session` 链接并重启。效果相同，但 `dsh.profile.bundles` 里的条目会留着（下一轮 `add`/`remove` 时由 `reconcile()` 收敛）；因此优先用步骤 2 的 `remove`。

## D. 走查结果记录（待执行后填写）

| 条目 | 结果（通过 / 不通过 / 未执行） | 实际观察到的现象 | 取证（控制台 / 截图 / 命令输出） |
|---|---|---|---|
| A1 行内 trash + Tooltip | 未执行 | | |
| A2 右键项位置与危险色 | 未执行 | | |
| A3 当前会话置灰 | 未执行 | | |
| A4 运行中置灰与恢复 | 未执行 | | |
| A5 确认框内容 | 未执行 | | |
| A6 按钮顺序与样式 | 未执行 | | |
| A7 取消零副作用 | 未执行 | | |
| A8 删除生效 + 成功提示 | 未执行 | | |
| A9 磁盘消失 + 搜索不到 | 未执行 | | |
| A10 已归档会话可删 | 未执行 | | |
| A11 空白会话无入口 | 未执行 | | |
| A12 面板激活态可删 | 未执行 | | |
| A13 / C.3 禁用后干净回滚 | 未执行 | | |
| B1 运行中被拒文案 | 未执行 | | |
| B2 会话不存在文案 | 未执行 | | |
| B3 失败原因文案 | 未执行 | | |
| B4 成功文案 | 未执行 | | |
| B5 / C.1 服务端兜底 | 未执行 | | |
| B6 无部分成功假象 | 未执行 | | |
| B7 不自动切换会话 | 未执行 | | |
| B8 无撤销入口 | 未执行 | | |
| B9 / C.2 搜索对账 | 未执行 | | |
| B11 冲突复核的运行确认 | 未执行（静态审计见 `conflict-audit-result.md`） | | |
| B15 「…」按钮相邻关系 | 未执行 | | |

## E. 走查顺序建议

1. 先 `npm test`（64 条）——逻辑层先绿，真机问题才好归因到「接线」而不是「逻辑」。
2. 按 A1→A12 线性走一遍（都是无害操作，只有 A8/A9/A10 会真的删数据，用一个可牺牲的会话）。
3. 再做 C.1（需要造活动），失败文案相关的 B1/B2/B3/B5/B6 都在这一步里顺带看完。
4. 最后做 C.3（禁用/移除）——它是终局状态，做完要重新装回来才能继续别的走查。
5. 任何不通过项：先看 DevTools 控制台与 `~/.dsh/profiles/desktop/.plugin-manager/logs/` 下最近的 `operation-*/pnpm.log`，再决定是插件问题还是装载问题。
