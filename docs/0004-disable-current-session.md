# 4. 删除入口的禁用条件：运行中会话（第一道「当前会话」已于 2026-11-19 撤销）

日期：2026-11-19
状态：已接受

> 原标题「当前会话禁用删除，通过 mainView 引用计数判定」。增加第二道条件后改名，文件名保持不变以维持引用稳定。

## 背景

删除一个还在活动中的会话会导致两种损坏：

1. **当前会话**：它正被主视图持有引用。删除后视图指向一个不存在的会话，`dsh-session-persistence-jsonl` 的写锁也会失效。
2. **运行中会话**：它仍有未停止的工作（正在生成的回复、子 agent、后台 job、活动 schedule）。`rm -rf` 正在写入的目录会损坏日志。

用户要求「当前会话显示按钮但置灰 + hover 提示」，而不是完全隐藏——这样入口位置固定，不会因为当前会话不同而跳动。同一原则也适用于运行中会话。

## 决策

### 第一道：当前会话

判定用 `retainedBy.mainView > 0`，不是 `activePanelId`，也不是选中态。

`activePanelId` 仅用于辅助判定「面板是否处于激活状态（如 diff 面板打开）」，此时没有单一当前会话，因此不判定任何行为当前会话：

```js
const panelActive = usePanelInfo(info => info.activePanelId !== null)
if (panelActive) return undefined // 面板激活状态下没有单一当前会话
return Object.values(list.byId)
  .find(session => (session.retainedBy.mainView ?? 0) > 0)?.id // 真正的当前会话判定
```

### 第二道：运行中会话

判定用 `SessionSummary.running === true`（`dsh-api-session-controller/src/client/contract/snapshot.ts:88`），通过全局 `useSessions` 读取，不额外注入、不发请求：

```js
const running = useSessions(s => s.byId[sessionId]?.running === true)
```

### 两道条件的行为一致

命中任一条件时：
- 行内按钮 `disabled: true`，Tooltip 与 `aria-label` 写对应原因（「不能删除当前会话」/「会话正在运行，请先停止」）
- 右键菜单项 `disabled: true`，其余菜单项不受影响

**服务端闸门保留**：客户端的两道条件都是「更早、更窄」的提示，不是权威判定。权威判定在 Host 半的 `ctx.waterfall('workspace/session-activity', ...)`（ADR-0001 第 0 步），它覆盖客户端 `running` 看不到的子 agent、后台 job、活动 schedule。两者不冲突：客户端提前告知，服务端兜底。

## 理由

- `mainView` 是 DSH 内部用来标记「主视图正在展示哪个会话」的引用计数（`WorkspaceBrowser.tsx:325-329`）。面板激活时没有唯一 mainView，所以此时不判定任何行为当前会话。
- 置灰而非隐藏，保留入口位置的一致性；用户不需要重新找按钮。若在 `resolve` 里返回 `[]`，右键菜单会突然少一项，用户会以为是 bug。
- **把失败前移**：按原流程，用户要先点入口、再点确认框、才被告知「会话正在运行」——两次点击换一个失败。而 `running` 在点之前就是已知信息。置灰把失败成本从「两次点击」降到「零次点击 + 一次 hover」。
- **不冲突**：`running` 只覆盖「有轮次在跑」，比服务端 waterfall 窄。窄的放客户端、全的放服务端，是正确分工，不是重复。
- `running` 变化频繁（每轮对话翻转），置灰状态会跟着动——这正是想要的：任务跑完按钮自动变为可点。

## 后果

- 用户想删当前会话，需先切到另一个会话。
- 用户想删运行中的会话，需先停止该任务。这是刻意保护（ADR-0001 否决了「强制停止后删除」）。
- `mainView` 与 `running` 都是 DSH 内部字段，若未来改名需同步更新判定逻辑。
- 面板模式下（如 diff 面板激活）所有非运行中行都可删——这是刻意的，因为此时没有单一当前会话。
- 存在「客户端显示可点、点完被服务端拒绝」的残余窗口：`running === false` 但有子 agent / job / schedule 在跑。此时走 toast 告知 `SESSION_ACTIVE`，行为正确。

## 修订 2026-11-19（用户决定，撤销第一道条件）

**撤销**：不再因「当前会话」（`retainedBy.mainView > 0`）置灰。新的判定只有两条：

| 行的状态 | 行内按钮 | 右键菜单项 |
|---|---|---|
| 空白（未落盘） | 不渲染 | 不出现 |
| 运行中（`running === true`） | 显示、置灰 | 显示、置灰 |
| 其余（**含当前会话**） | 显示、可点 | 显示、可点 |

**为什么撤销**：

1. **最后一个会话会死锁**。只剩一个会话时它必然是当前会话，按原规则这个入口永远置灰——用户想清理磁盘时被自己的保护挡住，而保护针对的「视图指向已删会话」是可以由 DSH 自行收敛的非数据损失。
2. **官方并不拦当前会话**。`archiveSession` 在写归档集合前只走 `workspace/session-activity` 闸门（`dsh-workspace/src/index.ts:389-393`），没有「当前会话」这条限制。第一道条件是本插件自己加的，去掉它没有偏离宿主语义。
3. **活动判定的保护仍然完整**。删除正在写入的目录才是真正的数据损坏风险，而它由第二道条件 + 服务端 `workspace/session-activity` waterfall 兜住，与「是否当前会话」无关。

**代价（已接受）**：

- 删掉当前会话后，主视图会短暂指向一个不存在的会话，直到 DSH 的会话侦测收敛。ADR-0006 的「不自动切换」在这个场景下第一次真正生效——这正是当初选它的理由。
- **曾担心的风险（2026-11-19 真机实测未复现）**：担心正在主视图里打开的会话其日志文件仍被 DSH 持有句柄，Windows 上 `rm` 可能返回 `EPERM/EBUSY`。用户在同日真机重启后删除了正在查看的会话，**删除成功、未出现文件占用失败**。因此不加重试/等待逻辑的决定维持不变；若将来在别的文件系统/杀软环境下复现，再单独评估。

**连带影响**：`label.deleteCurrentDisabled` 从字典移除（无引用）；客户端 `usePanelInfo` 与 `inject` 里的 `layout` 不再需要；「面板激活态」不再是矩阵中的独立一档（它原本只服务于第一道条件）。实现见分支 `allow-current-session` 的合并提交。
