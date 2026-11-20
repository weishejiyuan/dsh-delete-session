# dsh-delete-session — DSH 桌面端会话永久删除插件

为 DeepSeek Harness (DSH) 桌面端增加「会话永久删除」功能。

DSH 原生只支持「归档」会话（从侧栏隐藏，磁盘文件仍留在原处），没有真正删除会话的入口。本插件补齐这个缺口：会话行右侧出现删除按钮，右键菜单中出现「永久删除」选项，点击后会话的磁盘目录会被递归删除，workspace 注册表中的归档与置顶标记也会被清除，搜索索引由 DSH 自己的对账机制自动收敛。

---

## 1. 项目解决什么问题

| 操作 | DSH 原生 | 本插件 |
|---|---|---|
| 归档会话（移出侧栏，文件仍在） | ✅ | — |
| 置顶会话 | ✅ | — |
| **永久删除会话（连磁盘目录一起清）** | ❌ | ✅ |
| 删除后自动从搜索索引消失 | — | ✅（由 DSH 索引对账机制自动完成） |

没有本插件时，想彻底清掉一个会话只能手动去 `~/.dsh/sessions/<project>/<sessionId>/` 翻目录删除，或者重装 DSH。

---

## 2. 主要功能

### 2.1 两个删除入口

- **会话行内按钮**：会话行 hover 时，右侧按钮条出现垃圾桶图标（悬停 500ms 显示「永久删除」Tooltip）。
- **右键菜单**：会话行右键，菜单出现「永久删除」，带分隔线和危险色图标。

两个入口共用同一套可见性规则和同一个确认框。

### 2.2 确认框防误删

点删除后不会直接执行，而是弹出全窗口确认框：
- 显示被删除会话的标题
- 副文案：“此操作不可撤销”
- 左侧「取消」，右侧「永久删除」（危险色文字，非实心红块）
- 点「取消」什么都不发生；点「永久删除」才执行删除

### 2.3 删除执行流程（Host 半）

删除执行四步，顺序不可交换：

1. **活动检查** —— 询问 DSH 该会话是否还有运行中的工作（回话、子 agent、后台 job、定时任务）。有则拒绝，不碰磁盘。
2. **递归删除文件** —— 通过持久化层定位会话目录，确认在 sessions 根目录内，递归删除目录及日志文件。
3. **清归档标记** —— 把该会话从 workspace 的归档集合移除。
4. **清置顶标记** —— 把该会话从 workspace 的置顶集合移除。

删除成功后，Host 半会向客户端广播 `workspace/session-removed` 事件，让侧栏立刻消失该会话，不会留下幽灵行。

删除是**整体成功或整体失败**：所有步骤都完成才返回成功；中途任一步抛错即整体失败，不做部分成功报告。

### 2.4 可见性规则

| 会话状态 | 行内按钮 | 右键菜单项 |
|---|---|---|
| 普通会话 | 显示，可点 | 显示，可点 |
| 当前会话（正在主视图展示） | 显示，可点 | 显示，可点 |
| 运行中会话（有活跃工作） | 显示，置灰 | 显示，置灰 |
| 已归档会话 | 显示，可点 | 显示，可点 |
| 空白新会话（未落盘） | 不显示 | 不显示 |

运行中会话置灰时，悬停提示「会话正在运行，请先停止」；任务结束后自动恢复可点。空白会话没有落盘目录，删除没有意义，因此不显示入口。

---

## 3. 安装方法

### 3.1 前提

1. DSH 桌面端已安装，且至少启动过一次（让 `~/.dsh/profiles/desktop/package.json` 存在）。
2. **装插件前完全退出 DSH**（托盘退出，任务管理器确认 `DeepSeek Harness.exe` 已结束）。
3. 必须使用桌面安装目录自带的 `dsh` 命令行工具（形如 `<安装目录>\resources\app\runtime\cli\bin\dsh.cmd`，带 `--expose-internals` 调用 `dsh-desktop-host`），不能用 `node ...\node_modules\@deepseek-ai\dsh\lib\bin.js`。

### 3.2 安装命令

```bat
dsh plugin --profile desktop add link:<你的插件目录路径>
```

例如本仓库克隆到本地后：

```bat
dsh plugin --profile desktop add link:C:\path\to\dsh-delete-session
```

`link:` 方式安装：插件以**目录联接**形式挂进 profile，**改代码后重启 DSH 即生效**，不需要重新安装。

### 3.3 验证安装

1. `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 末尾出现 `@local/dsh-delete-session`。
2. `~/.dsh/profiles/desktop/node_modules/@local/dsh-delete-session` 是指向你仓库目录的符号链接（Junction）。
3. 启动 DSH：侧栏会话行 hover 出现垃圾桶按钮，右键菜单底部出现「永久删除」。

### 3.4 回滚

```bat
:: 完全退出 DSH 之后执行
dsh plugin --profile desktop remove @local/dsh-delete-session
```

然后重启 DSH。`remove` 会把 `package.json` 的 dependency、`pnpm-lock.yaml`、`node_modules` 链接，以及 `dsh.profile.bundles` 里对应条目一起回滚。

也可以直接删掉 `~/.dsh/profiles/desktop/node_modules/@local/dsh-delete-session` 链接后重启；效果相同，但 `dsh.profile.bundles` 里的条目会残留到下一次 `add`/`remove` 才被收敛，所以优先用 `remove`。

**无需清理任何持久化数据**：本插件没有配置文件、没有独立数据库，也不修改 DSH 的持久化结构。它唯一的写操作是删除会话目录本身，以及用宿主 registry 的 API 把该会话从归档/置顶集合里摘掉——两者都只作用于「已经被删掉的会话」，回滚插件不会留下需要手工清理的残留。

---

## 4. 使用方法

### 4.1 删除一个会话

1. 在左侧会话栏找到要删除的会话。
2. 鼠标悬停在会话行上，右侧出现垃圾桶图标按钮；或者右键点击会话行。
3. 点删除按钮 / 选择「永久删除」，弹出确认框。
4. 确认框显示会话标题和「此操作不可撤销」提示。
5. 点「永久删除」执行；点「取消」则关闭对话框，不做任何更改。

删除成功后：会话从侧栏消失，弹出「会话已永久删除」提示。

### 4.2 什么时候删不了

| 情况 | 表现 |
|---|---|
| 会话正在运行（生成回复中） | 按钮置灰，悬停提示「会话正在运行，请先停止」。任务结束后自动恢复 |
| 会话不存在（可能已被删） | 提示「会话不存在，可能已被删除」 |
| 删除过程出错（权限、文件占用等） | 提示「删除失败」并附上具体原因 |

### 4.3 已归档会话

已归档的会话也显示删除入口，可以直接删除，不需要先取消归档。

### 4.4 空白新会话

还没发过消息、尚未落盘的空白会话行不显示删除入口——它没有目录可删，删除只会报错。

---

## 5. 输入输出示例

### 5.1 用户在界面上的操作

```
[会话行 hover]  →  右侧出现垃圾桶图标按钮（悬停 500ms 显示「永久删除」）
       ↓ 点击
[确认框]  ┌─────────────────────────────────────┐
          │ 永久删除会话                        │
          │ 将永久删除「帮我重构登录模块」，      │
          │ 此操作不可撤销。                    │
          │              [取消] [永久删除]      │
          └─────────────────────────────────────┘
       ↓ 点「永久删除」
[提示]   ✓ 会话已永久删除
```

### 5.2 插件 Host 与 Client 之间的请求/响应

Client 半向 Host 半发送 POST 请求：

```http
POST /delete-session/api/delete
Content-Type: application/json

{
  "sessionId": "session-01J8X2K9ABC"
}
```

Host 半响应（成功）：

```json
{
  "ok": true,
  "code": "OK"
}
```

各种失败情况：

| HTTP 状态 | 返回 body | 触发条件 |
|---|---|---|
| 200 | `{ "ok": true, "code": "OK" }` | 删除成功 |
| 409 | `{ "ok": false, "code": "SESSION_ACTIVE", "message": "会话正在运行，请先停止" }` | 会话仍有运行中的工作 |
| 404 | `{ "ok": false, "code": "SESSION_NOT_FOUND", "message": "会话不存在，可能已被删除" }` | 两种命名形态的目录都不存在 |
| 500 | `{ "ok": false, "code": "DELETE_FAILED", "message": "<具体原因>" }` | 递归删除或 registry 清理抛错 |
| 405 | `{ "ok": false, "code": "METHOD_NOT_ALLOWED" }` | 非 POST 请求 |
| 400 | `{ "ok": false, "code": "INVALID_SESSION_ID" }` | 请求体缺 sessionId 或为空 |

### 5.3 可见性规则示例（代码层面）

```js
// 伪代码，示意行内按钮和右键菜单共用同一套判断
function visibilityOf(row) {
  if (row === undefined || row.blank === true) {
    return { show: false, disabled: false }   // 空白会话：不显示
  }
  const running = row.running === true
  return {
    show: true,
    disabled: running,                        // 运行中：显示但禁用
    labelKey: running ? 'sessionActive' : 'label.deletePermanently'
  }
}
```

---

## 6. 已知限制

- **删除不可逆**：没有撤销窗口，没有回收站。误删只能从备份/卷影副本/文件系统恢复，DSH 不提供内置路径。
- **运行中会话不能被删除**：要删除正在生成回复的会话，先停止任务再删。
- **只作用于会话级**：不处理 workspace 记录、不碰 workspace 自身的 `sessionIds` 数组（那是 workspace 级记录，由 DSH 自己维护）。
- **安装绑定 desktop profile**：本插件按 `--profile desktop` 安装，换 profile 需重装。

