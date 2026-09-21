# 多步表单：分支 / 回退 / 草稿 / 校验依赖 / 异步校验

零依赖实现。XState 风格自研状态机 + IndexedDB 草稿持久化 + Web Worker 异步校验。

## 运行

```bash
npm test          # 20 个测试，覆盖全部验收标准
npm run serve     # http://localhost:8080 打开可交互 demo
```

## 架构

```
src/
  machine.js        通用 FSM：state 恒为纯 JSON {value, context, history}，
                    transition 是纯函数，副作用以 effects 形式返回给解释器
  formMachine.js    表单机工厂：分支 guard、BACK 历史栈、分支合并、扁平 formData
  validation.js     校验依赖图（传递闭包失效传播）+ token 防竞态协调器
  controller.js     解释器：串联状态机 / 校验 / 自动保存 / 分享，提供 serialize/restore
  storage.js        IndexedDB 草稿存储（backend 可注入，测试用内存实现）
  share.js          草稿分享编码：base64url(JSON) + FNV-1a 校验和，防篡改
  validationClient.js  主线程 Worker 客户端（无 Worker 环境自动降级为内联执行）
  worker/validationWorker.js  异步校验 Worker（模拟服务端延迟）
  signupForm.js     示例表单：account → (personal | company) → review → done
index.html / src/app.js  可交互 demo
```

## 关键设计

**状态机可序列化**：machine state 只含 `value`（当前步骤）、`context.formData`
（扁平数据）、`history`（回退栈）。guard/reducer 等函数只存在于 config，
不进入 state。任意时刻 `JSON.stringify` 即可持久化，`resolveState` 恢复并校验合法性。

**分支与合并**：`next` 为带 `when` guard 的有序候选列表实现分支；多个分支指向
同一 target 实现合并。所有字段存在同一张扁平 `formData` 上，切换分支不删数据。

**校验依赖**：每个 validator 声明 `deps`，协调器预计算反向依赖的传递闭包。
字段变更时，所有（传递）依赖它的字段标记 `stale` 并自动重新校验。

**异步竞态**：每次校验分配单调递增 token，结果仅在 token 仍为该字段最新时
应用（`applied:false` 直接丢弃）。乱序返回、快速连续编辑都不会出现旧结果
覆盖新结果。校验在 Web Worker 中执行，主线程只负责 token 仲裁。

**草稿恢复**：每次转换后防抖 150ms 自动保存快照到 IndexedDB；刷新后
`restoreFromDraft` 恢复。恢复时处于 `pending` 的校验会自动重跑。

**草稿分享**：`shareToken()` 生成 `v1.<base64url>.<checksum>` 令牌（可放 URL
hash），`restoreFromShareToken` 恢复；checksum 不匹配即拒绝。

## 验收标准 → 测试对照

| 验收标准 | 测试 |
| --- | --- |
| 任意步骤刷新可恢复 | `refresh recovery: serialize mid-flow, restore into a fresh controller`、`draft store: autosave … and resume` |
| 分支切换不丢数据 | `branch switch does not lose the other branch's data` |
| 异步校验无竞态 | `async race: out-of-order resolution never applies stale results`、`race across rapid edits — only the last edit wins` |
| 草稿可分享 | `share token: full round-trip …`、`tampering is detected via checksum` |
| 状态机可序列化 | `machine state is JSON-serializable at every step`、`full journey: … serializable the whole way` |
| 校验依赖 | `dependency graph …`、`changing a dependency marks dependents stale and revalidates` |
| 分支合并 / 回退 | `branch merge: both branches converge`、`back navigation pops the history stack` |
