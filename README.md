# @local/dsh-delete-session

DSH 桌面端的「会话永久删除」插件。两个入口：会话行内按钮 + 会话右键菜单。

## 这个仓库是什么

只放**实现代码**。设计文档、决策记录、ticket 在另一个仓库：

```
E:\ai编程需要的软件安装包\dsh-delete-session
```

写代码前必须先读那边的 `AGENTS.md`——它含当前状态、文档地图，以及三条动手前硬约束。

## 三条硬约束（摘要，详见设计仓库的 AGENTS.md）

1. **Client 半不是 ESM**。必须写成 classic script，加载时立即 `window.__ModuleLoader__.load({id, factory})` 注册工厂，依赖通过工厂收到的同步 `require` 取。写成 `export function apply(ctx)` 会报 `loaded without registering`。
2. **不引入打包器**。手写工厂包装，用 `React.createElement` 而非 JSX。不建 `locale/*.json`，字符串内联。
3. **删除顺序不可交换**：活动闸门 → `sessionPersistence.stat` 定位 → sessions 根围栏 → `rm -rf` → `unarchiveSession` → `unpinSession` → 发 `api-session/removed`。活动检查必须在任何文件操作之前。

## 当前状态

**实现完成，已装真机，用户确认可用。**

- 代码侧由 66 条自动化测试覆盖：`npm test`（`node --test`，零依赖）
- 真机验收记录：[`docs/manual-acceptance.md`](./docs/manual-acceptance.md)（3 项逐条留证，其余为用户确认通过但未逐条留证）
- 与已装插件的冲突复核：[`docs/conflict-audit-result.md`](./docs/conflict-audit-result.md)
- 实现期逐条核实的 DSH 源码契约（槽位/菜单/locale/路由/会话存储/安装机制，带文件行号与对账结论）：[`docs/dsh-source-facts.md`](./docs/dsh-source-facts.md)

后两份是指向 `0.2.2-rc.3` 本机解包态的**快照**：DSH 升级后行号会漂移，重审前先按 `docs/dsh-source-facts.md` 末节「与设计文档不一致处」的方法重核。

## 两条容易回退的坑

- **删完必须发 `api-session/removed`**。`session.list` 是「磁盘行 + 本进程仍驻留的会话行」的并集，只删文件不通知，会话行会留在侧栏变幽灵行；`sessions.refresh()` 修不掉（内存里那份照样在）。详见设计仓库的 `docs/adr/0006-no-auto-switch.md`。
- **当前会话不置灰**。只保留运行中置灰——最后一个会话置灰会造成既不能删也不能切走的死锁。

## 安装

调试本仓库的代码时安装的是**这个目录**，DSH 直接从工作区读代码，不需要 `npm pack`/`npm publish`。

### 前提

1. **必须用桌面安装目录自带的 `dsh.cmd`**（形如 `<安装目录>\resources\app\runtime\cli\bin\dsh.cmd`，它带 `--expose-internals` 调 `dsh-desktop-host/lib/cli.js`）。
   不能用 `node ...\node_modules\@deepseek-ai\dsh\lib\bin.js`：`--profile desktop` 会被 `rejectElectronProfile` 直接拒掉（`error: profile "desktop" is managed exclusively by the Electron application`），因为只有桌面端 CLI 载体才会传 `manageDesktopProfile: true`。
2. **桌面端至少启动过一次**，让 `~/.dsh/profiles/desktop/package.json` 存在。否则 `dsh plugin` 会报 `Open DeepSeek Harness Desktop once to initialize its profile, then fully quit it before running dsh plugin --profile desktop.`
3. **装前完全退出 DSH**（托盘退出，任务管理器确认 `DeepSeek Harness.exe` 已结束）。

### 命令

```bat
:: 完全退出 DSH 之后执行（路径换成你的仓库路径）
dsh plugin --profile desktop add link:E:\develop\dsh-plugins\dsh-delete-session
```

`link:` 指向绝对路径时会被原样透传给 pnpm，不做路径改写。

### 装完检查

1. `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` **末尾**出现 `@local/dsh-delete-session`（新装的 bundle 永远追加在最后，位置即层顺序）。
2. `~/.dsh/profiles/desktop/node_modules/@local/dsh-delete-session` 是指向仓库的符号链接。
3. 启动 DSH：侧栏会话行 hover 出现 trash 按钮，右键菜单底部出现「永久删除」。

### 为什么 `package.json` 里的 `dsh.bundle.patch` 是成为 profile 层的前提

`add` 成功（pnpm exit 0）后，`dsh-plugin-manager` 会对新装的 dependency 做 reconcile：

- 包**没有** `dsh.bundle` → 只当普通依赖装上，打一条 warning 并**不加入** `dsh.profile.bundles`，插件不会加载：
  `dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer`
- 包**有** `dsh.bundle` → 校验平台、预加载其 patch 文件，然后把包名 append 到 `dsh.profile.bundles` 并原子写回 `package.json`。

本包的 `package.json` 因此声明了 `dsh.bundle.patch: "./cordis.patch.yml"`。

`cordis.patch.yml` **只插一行 Host 半**。Client 半由 `dsh-client-modules` 扫描 `package.json` 的 `dsh.client` 字段自动发现，不需要（也**不能**）在 patch 里再插一行——同一个包出现两个 Loader 源会让整包 client 半加载失败：
`client-modules: package <name> resolves from multiple active Loader sources`。

## 回滚

```bat
:: 完全退出 DSH 之后执行
dsh plugin --profile desktop remove @local/dsh-delete-session
```

然后重启 DSH。`remove` 会把 `package.json` 的 dependency、`pnpm-lock.yaml`、`node_modules` 链接，以及 `dsh.profile.bundles` 里对应条目一起回滚（`dsh-plugin-manager` 的 reconcile 会剔除「已不再是 dependency」的 bundle）。

也可以直接删掉 `~/.dsh/profiles/desktop/node_modules/@local/dsh-delete-session` 链接后重启；效果相同，但 `dsh.profile.bundles` 里的条目会残留到下一次 `add`/`remove` 才被收敛，所以优先用 `remove`。

**无需清理任何持久化数据**：本插件没有配置文件、没有独立数据库，也不修改 DSH 的持久化结构。它唯一的写操作是删除会话目录本身，以及用宿主 registry 的 API 把该会话从归档/置顶集合里摘掉——两者都只作用于「已经被删掉的会话」，回滚插件不会留下需要手工清理的残留。

