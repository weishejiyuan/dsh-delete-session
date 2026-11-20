# 2. Host↔Client 用 HTTP 路由，不用 host.call

日期：2026-11-19
状态：已接受

## 背景

DSH 里有三条代码执行路径，通信机制各不相同：

| 形态 | Host 环境 | 通信方式 |
|---|---|---|
| Profile bundle | 真实 Node.js | `ctx.webServer.register` + `fetch('/…')` |
| 动态包 | `node:vm` 沙箱 | `harness.handle` + `host.call` |
| 官方内置 | 真实 Node.js | cordis service 直接调用 |

v1 指南把动态包的机制当成通用规则，导致「`host.call('deleteSession')` 能调到 `ctx.deleteSession`」这种错误结论。

## 决策

本插件的 Host 半注册 `ctx.webServer.register({kind:'prefix', path:'/delete-session/api', handler})`；Client 半用 `fetch('/delete-session/api/<method>', {method:'POST', body})` 调用。不用 `host.call`，不在 ctx 上挂方法。

## 理由

1. `host.call` 走的是动态包专属的 RPC 表（`dsh-cordis-host-runner/src/index.ts:774` `run.handlers.get(method)`），这张表只由 `harness.handle` 填充。Profile bundle 的 Host 半跑在真实 Node 环境里，没有 `harness` 这个对象。
2. 真实插件（`dsh-better-sidebar`）就是这个做法：Host 侧 `lib/index.js:10167` 注册 `/sidebar/api`，Client 侧 `lib/client.js:1216` `fetch('/sidebar/api/…')`。照抄已验证的路径比发明新路径风险低。
3. `ctx.webServer.register` 是 `ctx.effect` 包裹的，HMR 时自动摘除路由，不留孤儿 handler。

## 后果

- 路由路径必须全局唯一：`(kind, path)` 重复注册会让启动失败（`dsh-host-webserver/src/index.ts:445-451`）
- 需要自己处理鉴权：`ctx.connection.requestRejection(req) === void 0` 表示放行。它的语义是**受信 Host/Origin + 已认证凭据**，不只是「同源」；拒绝时返回 `401` / `403` 的 HTTP 状态。
- 需要自己处理 method / body 解析；同源场景下无需 CORS，跨源场景才需要
- 好处是调试直观：浏览器 DevTools 网络面板能直接看到请求与响应