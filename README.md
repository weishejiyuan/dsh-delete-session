# @local/dsh-delete-session

DSH 桌面端的「会话永久删除」插件。两个入口：会话行内按钮 + 会话右键菜单。

## 这个仓库是什么

只放**实现代码**。设计文档、决策记录、待做 ticket 在另一个仓库：

```
E:\ai编程需要的软件安装包\dsh-delete-session
```

写代码前必须先读那边的 `AGENTS.md`——它含当前状态、文档地图，以及三条动手前硬约束。

## 三条硬约束（摘要，详见设计仓库的 AGENTS.md）

1. **Client 半不是 ESM**。必须写成 classic script，加载时立即 `window.__ModuleLoader__.load({id, factory})` 注册工厂，依赖通过工厂收到的同步 `require` 取。写成 `export function apply(ctx)` 会报 `loaded without registering`。
2. **不引入打包器**。手写工厂包装，用 `React.createElement` 而非 JSX。不建 `locale/*.json`，字符串内联。
3. **删除顺序不可交换**：活动检查 → 递归删文件 → 清 archive → 清 pin。活动检查必须在任何文件操作之前。

## 当前状态

代码未开始。第一步是设计仓库里的 ticket 01（运输脊椎）：先验证三个未知道，再写功能。
