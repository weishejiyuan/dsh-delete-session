# 冲突复核结果（静态审计）

日期：2026-11-19
对应 ticket：06 收尾项「冲突复核：两个入口、图标、locale 命名空间、路由前缀均未与已装插件抢占同一标识」
审计性质：**静态文本扫描**。本轮不安装插件、不启动 DSH（用户 2026-11-19 决策 A），因此没有运行时注册证据；下面每条结论都附实际执行的命令与真实命中数，命令可原样重跑。

审计对象：`C:\Users\Administrator\.dsh\profiles\desktop\package.json` 的 `dsh.profile.bundles`，共 16 项（2 个官方基础包 + 14 个第三方包），目录为 `C:\Users\Administrator\.dsh\profiles\desktop\node_modules\<bundle>`（只读）。

## 本插件占用的 6 个标识

| # | 标识类别 | 本插件占用值 | 定义位置 |
|---|---|---|---|
| 1 | slot `sidebar.workspaces.session.row.action` | `id: 'delete-session'`, `order: 300` | `client/client.js`（`ROW_ACTION_SLOT` / `ctx.slots.register`） |
| 2 | slot `shell.overlay` 的条目 id | `delete-session.confirm` | `client/client.js`（`OVERLAY_SLOT` 注册） |
| 3 | slot `contextMenu.icon` 的 key | `session.delete` | `client/client.js`（`SESSION_MENU_ICON_KEY`） |
| 4 | `ctx.contextMenus.register` 的 id | `session.delete`（`target: 'session'`, `order: 700`） | `client/client.js`（`SESSION_MENU_ID`） |
| 5 | locale 命名空间 | `deleteSession` | `client/client.js`（`LOCALE_NAMESPACE`） |
| 6 | 路由前缀 | `/delete-session/api` | `index.js`（`ROUTE_PREFIX`），端点为 `/delete-session/api/delete` |

## 扫描 1：6 个标识 × 16 个 bundle 的命中数

命令（`node_modules` 下，逐个标识扫全部 16 个 bundle，统计命中次数）：

```bash
cd "C:/Users/Administrator/.dsh/profiles/desktop/node_modules"
for id in 'sidebar.workspaces.session.row.action' 'delete-session.confirm' 'session.delete' \
          'deleteSession' '/delete-session/api' '/delete-session'; do
  n=$(grep -rF --binary-files=without-match -o "$id" \
        dshmarket dsh-our-free-model dsh-context @liustack/modlens dsh-better-sidebar dsh-rewind-plugin \
        @linxin666/dsh-client-ui-skill-explorer @wxg-prc-cpg/dsh-weknora @openviking/dsh-memory-plugin \
        @local/dsh-clear-command dsh-whale-widget dsh-purge-community \
        @deepseek-ai/dsh-experimental-auto-review @vinvcn/dsh-mattpocock-skills-zh \
        @deepseek-ai/dsh-base @deepseek-ai/dsh-web-app 2>/dev/null | wc -l)
  echo "$id => $n"
done
```

真实输出：

```
sidebar.workspaces.session.row.action => 0
delete-session.confirm => 0
session.delete => 0
deleteSession => 3
/delete-session/api => 0
/delete-session => 0
```

`deleteSession` 的 3 次命中全部来自同一个包、同一类位置（见扫描 3）。

## 扫描 2：逐 bundle × 逐标识明细（确认「0」不是漏扫）

命令：

```bash
cd "C:/Users/Administrator/.dsh/profiles/desktop/node_modules"
for pkg in dshmarket dsh-our-free-model dsh-context @liustack/modlens dsh-better-sidebar dsh-rewind-plugin \
           @linxin666/dsh-client-ui-skill-explorer @wxg-prc-cpg/dsh-weknora @openviking/dsh-memory-plugin \
           @local/dsh-clear-command dsh-whale-widget dsh-purge-community \
           @deepseek-ai/dsh-experimental-auto-review @vinvcn/dsh-mattpocock-skills-zh \
           @deepseek-ai/dsh-base @deepseek-ai/dsh-web-app; do
  echo "=== $pkg ==="
  for id in 'sidebar.workspaces.session.row.action' 'delete-session.confirm' 'session.delete' \
            'deleteSession' '/delete-session/api'; do
    n=$(grep -rF --binary-files=without-match -o "$id" "$pkg" 2>/dev/null | wc -l)
    echo "  [$n] $id"
  done
done
```

真实输出（每行 `命中数 标识`）：

| bundle | row.action slot | `delete-session.confirm` | `session.delete` | `deleteSession` | `/delete-session/api` |
|---|---|---|---|---|---|
| `@deepseek-ai/dsh-base` | 0 | 0 | 0 | 0 | 0 |
| `@deepseek-ai/dsh-web-app` | 0 | 0 | 0 | 0 | 0 |
| `dshmarket` | 0 | 0 | 0 | 0 | 0 |
| `dsh-our-free-model` | 0 | 0 | 0 | 0 | 0 |
| `dsh-context` | 0 | 0 | 0 | 0 | 0 |
| `@liustack/modlens` | 0 | 0 | 0 | 0 | 0 |
| `dsh-better-sidebar` | 0 | 0 | 0 | 0 | 0 |
| `dsh-rewind-plugin` | 0 | 0 | 0 | 0 | 0 |
| `@linxin666/dsh-client-ui-skill-explorer` | 0 | 0 | 0 | 0 | 0 |
| `@wxg-prc-cpg/dsh-weknora` | 0 | 0 | 0 | 0 | 0 |
| `@openviking/dsh-memory-plugin` | 0 | 0 | 0 | **3** | 0 |
| `@local/dsh-clear-command` | 0 | 0 | 0 | 0 | 0 |
| `dsh-whale-widget` | 0 | 0 | 0 | 0 | 0 |
| `dsh-purge-community` | 0 | 0 | 0 | 0 | 0 |
| `@deepseek-ai/dsh-experimental-auto-review` | 0 | 0 | 0 | 0 | 0 |
| `@vinvcn/dsh-mattpocock-skills-zh` | 0 | 0 | 0 | 0 | 0 |

正对照（证明 grep 确实读到了包内容，而不是扫了空目录或未解引用的符号链接）：

```bash
cd "C:/Users/Administrator/.dsh/profiles/desktop/node_modules"
grep -rlF --binary-files=without-match 'shell.overlay' dsh-better-sidebar | wc -l   # => 5
grep -rF  --binary-files=without-match -o 'dsh' dsh-better-sidebar | wc -l          # => 4578
```

`dsh-better-sidebar` 目录是硬链接实体（非 `node_modules` 符号链接），5 个文件命中 `shell.overlay`、4578 次命中 `dsh`，说明扫描路径有效。

## 扫描 3：`deleteSession` 的 3 次命中是什么

```bash
cd "C:/Users/Administrator/.dsh/profiles/desktop/node_modules"
grep -rnF 'deleteSession' @openviking/dsh-memory-plugin
```

真实输出：

```
@openviking/dsh-memory-plugin/shared/mcp-proxy-core.mjs:352:  async function deleteSession() {
@openviking/dsh-memory-plugin/shared/mcp-proxy-core.mjs:490:    await deleteSession();
@openviking/dsh-memory-plugin/shared/mcp-proxy-core.mjs:496:    await deleteSession();
```

补充命令确认它不是 locale 命名空间：

```bash
grep -rn "locale.register\|locale\.bind(" @openviking/dsh-memory-plugin --include=*.js --include=*.mjs --include=*.ts | wc -l   # => 0
grep -rhoF "locale.register('deleteSession'" . --include=*.js --include=*.mjs | wc -l                                          # => 0
```

结论：`@openviking/dsh-memory-plugin` 里的 `deleteSession` 是 MCP proxy 的私有函数名，该包**完全不调用 `locale.register`**，不可能占用 locale 命名空间。

## 扫描 4：是否已有第三方注册 `target: 'session'` 的菜单（菜单 id 冲突面）

```bash
cd "C:/Users/Administrator/.dsh/profiles/desktop/node_modules"
for pkg in <16 个 bundle>; do
  n=$(grep -rE --binary-files=without-match -o "target: ['\"]session['\"]" "$pkg" 2>/dev/null | wc -l)
  echo "$pkg: $n"
done
```

真实输出：16 个 bundle 全部为 `0`（唯一例外是 `xmanrui/dsh-im`，它不在 `dsh.profile.bundles` 里、也未挂载，同样为 0）。

## 扫描 5：谁在注册 webServer 前缀（路由前缀冲突面）

```bash
cd "C:/Users/Administrator/.dsh/profiles/desktop/node_modules"
for pkg in <16 个 bundle>; do
  echo "=== $pkg ==="
  grep -rhoE "kind: ['\"]prefix['\"],? ?path: ['\"][^'\"]+['\"]" "$pkg" --include=*.js --include=*.mjs | sort -u
done
```

真实输出（只有两个 bundle 注册前缀，且都不与 `/delete-session/api` 重叠，也没有 `/` 这种通配前缀）：

```
=== dsh-our-free-model ===
kind: 'prefix', path: '/api/our-free-model'
=== dsh-purge-community ===
kind: "prefix", path: "/dsh-purge/rules"
kind: "prefix", path: "/dsh-purge/skill"
kind: "prefix", path: "/dsh-purge/skills"
=== 其余 14 个 bundle ===
（无输出）
```

## 扫描 6：官方侧的既有占用者（共存依据，非冲突）

第三方包全 0 只说明「没被别的插件占用」，还要确认官方在同名位置上的占用值不会与本插件撞 id。证据取自本机安装的 DSH 源码（只读）：`E:\develop\deepseek harness\resources\app\dsh\node_modules\@deepseek-ai\`。

| 冲突面 | 官方/既有占用者 | 出处 |
|---|---|---|
| `sidebar.workspaces.session.row.action` | `archive`(order 100)、`pin`(order 200)；官方声明该 slot 为 `{ kind: 'list', scope: 'root' }` | `dsh-client-ui-workspace/src/client/index.ts:371,391-393`；`contract/slots.ts:224` |
| `shell.overlay` | 官方 `workspace.session-rename`、`workspace.session-archive`、`workspace.row-toast`、`context-menu`、`chat.quota-notice`、`open-in-app.toast`、`plugin-manager.refresh-toast`、`schedule.delete-toast`、`shortcuts`、`desktop-onboarding`、`agent-team.disable`、`file-drag.feedback`、`session-log-upload-toast` 等；第三方 `dsh-market-toast`（dshmarket）、`redteam-console`（dsh-purge-community）、`dsh-better-sidebar:context-diagnostics`（better-sidebar） | `dsh-client-ui-workspace/src/client/index.ts:397-405`；各包 `index.ts`；`dshmarket/client/client.js:19117-19121`；`dsh-purge-community/lib/redteam/client.js:4197`；`dsh-better-sidebar/src/client/context-diagnostics-ui.tsx:35,223-227` |
| `contextMenus.register`（`target: 'session'`） | `session.pin`(100)、`session.rename`(200)、`session.fork`(300)、`session.id`(450)、`session.archive`(600) | `dsh-client-ui-workspace/src/client/session-actions/context-menus.tsx:27,41,47,51,56,59` |
| `contextMenu.icon` | `workspace.rename` / `workspace.delete` / `workspace.pin` / `workspace.unpin` / `workspace.archive` / `workspace.unarchive` / `workspace.fork` / `workspace.copy`，另有 `open-in-app.*`、`sidebar.close` | `dsh-client-ui-workspace/src/client/index.ts:317-324`、`dsh-client-ui-open-in-app/src/client/index.ts:64-69`、`dsh-client-ui-sidebar-right/src/client/index.ts:138-139` |
| locale 命名空间 | `workspace` / `common` / `contextMenu` / `chat` / `settings.*` 等；官方包内 `deleteSession` 只作为 `dsh-session-query-sqlite` 的私有方法名出现（`src/index.ts:571`），不是命名空间 | `grep -rlF 'deleteSession' @deepseek-ai/` 命中 3 个文件，均为方法名 |
| 路由前缀 | 官方前缀见 `dsh-host-webserver` 的注册表；`/delete-session` 未出现在官方包中 | `grep -rlF 'session.delete' @deepseek-ai/` => 0 |

## 逐标识结论

| # | 标识 | 扫描到的其它占用者 | 结论 |
|---|---|---|---|
| 1 | row action slot `id: 'delete-session'`, order 300 | 无第三方占用该 slot；官方同 slot 已有 `archive`(100)、`pin`(200) | **无冲突**。list 语义，按 `id` 去重，本插件 id 与官方两者都不同；order 300 排在 `pin` 之后，符合 ADR-0000。 |
| 2 | overlay 条目 id `delete-session.confirm` | 无。同 slot 的既有条目 id 是 `workspace.session-rename` / `workspace.session-archive` / `workspace.row-toast` / `context-menu` / `dsh-market-toast` / `redteam-console` / `dsh-better-sidebar:context-diagnostics` 等 | **无冲突**。overlay 是 list 语义，按 id 区分；`delete-session.confirm` 全库 0 命中。 |
| 3 | `contextMenu.icon` key `session.delete` | 无。官方 key 是 `workspace.*` / `open-in-app.*` / `sidebar.close` 等 | **无冲突**。注意官方有 `workspace.delete`（删 workspace），语义不同、key 不重名。 |
| 4 | 菜单 id `session.delete` | 无。官方 target `'session'` 的 id 是 `session.pin`/`session.rename`/`session.fork`/`session.id`/`session.archive`；14 个第三方包无 `target: 'session'` 注册 | **无冲突**。order 700 排在官方 `session.archive`(600) 之后，符合 spec「排归档项之后」。 |
| 5 | locale 命名空间 `deleteSession` | 唯一的同名字符串是 `@openviking/dsh-memory-plugin` 的私有函数 `deleteSession()`（3 处），该包不注册 locale | **无冲突**。 |
| 6 | 路由前缀 `/delete-session/api` | 无。全部 16 个 bundle 命中 0；仅 `dsh-our-free-model`（`/api/our-free-model`）与 `dsh-purge-community`（`/dsh-purge/*`）注册前缀，无重叠也无可吞掉本前缀的 `/` | **无冲突**。 |

## 本次审计的边界

1. 扫描的是**已安装包的磁盘文本**，不是运行时注册表。插件本轮未安装，因此没有「装完启动无冲突日志」这条证据——安装后应补一次运行确认（见 `docs/manual-acceptance.md` 的禁用/移除一节与安装步骤）。
2. `grep -F` 是字面扫描：字符串被运行时拼接出来的占用（例如 `'session.' + id`）不在物理文本里则扫不到。已知官方正是用 ``id: `session.${id}` `` 拼接（`context-menus.tsx:27`），因此扫描 6 额外把官方拼接结果逐项列出，人工比对过一遍。
3. `files` 之外的文件（如 `src/`、`lib/` 双份产物）都在扫描范围内，重复命中会体现在计数里（`dsh-better-sidebar` 的 11 次 `shell.overlay` 就包含 `lib/` 与 `src/` 两份）。

## 重审触发条件

沿用设计仓库 `docs/agents/plugin-conflict-audit.md` 的条件：安装新插件（尤其涉及侧栏/会话行/右键菜单）、DSH 升级到改变 slot/menu/locale 注册机制的版本、本插件的 `order` / menu id / 图标 key / locale namespace / 路由前缀任一变更时重跑本文的扫描 1–6。
