# 可恢复的多步分支表单

零依赖原生 ES Module 示例，实现多步表单的分支、回退、草稿、依赖校验和异步校验。

## 运行

```bash
npm start
```

然后打开 `http://localhost:5173`。测试：

```bash
npm test
```

## 架构

- `src/form/machine.js`：XState 风格的纯 reducer 状态机。事件输入、快照输出，状态中只有可 JSON 序列化数据。
- `src/form/config.js`：步骤、字段、分支和最终合并规则。
- `src/form/validationRules.js`：同步规则、依赖规则和模拟远端异步规则。
- `src/workers/validationWorker.js`：Module Worker，接收校验请求并支持按请求 ID 中止。
- `src/form/validationClient.js`：Worker RPC 客户端。
- `src/form/formController.js`：解释器，负责防抖、取消、请求版本比对、提交、保存和恢复。
- `src/form/draftStore.js`：IndexedDB 持久化，`localStorage` 只保存当前草稿指针。
- `src/form/share.js`：快照的 base64url 编解码和 URL 分享协议。
- `src/main.js`：DOM 渲染和用户交互。

## 状态机

核心快照：

```js
{
  status,                  // idle | validating | submitting | success
  currentStep,             // account | profile | employee | company | review
  branch,                  // employee | company
  values,                  // 所有通用字段和两个分支字段
  errors,                  // 字段错误
  touched,                 // 是否已交互
  completedSteps,          // 已完成步骤
  validationJobs,          // requestId -> { id, fields, reason, startedAt }
  pendingFields,           // validationJobs 的派生展示数据
  submitId,                // 当前提交请求 ID
  result,                  // 成功结果
  draftId,
  createdAt,
  updatedAt
}
```

主要事件：

- `INPUT` / `TOUCH`：更新字段、清理旧错误、记录分支。
- `VALIDATION_STARTED`：写入可序列化的请求任务，并原子移除同字段旧任务。
- `VALIDATION_SETTLED`：只有仍在 `validationJobs` 中的请求能提交结果。
- `VALIDATION_ABORTED`：移除被取代的任务，不改变字段值和草稿。
- `NAVIGATE`：在当前分支可见步骤中前进或回退。
- `SUBMIT_STARTED` / `SUBMIT_SUCCESS` / `SUBMIT_FAILURE`：提交请求同样使用 ID 防止迟到结果。
- `DRAFT_RESTORED` / `RESET_DRAFT`：恢复和重置。

## 分支与合并

通用字段始终保留：`accountType`、`username`、`email`、`country`、`fullName`、`postalCode`。

- 雇员字段：`employeeId`、`monthlySalary`、`benefitCoverage`。
- 企业字段：`companyName`、`taxId`、`registrationProof`。

两个分支的字段都在 `values` 中独立保存。切换分支只改变 `branch/currentStep`，不删除另一分支数据。最终提交由 `mergedSubmission(values, branch)` 合并通用字段和当前分支字段。

## 校验依赖

- `postalCode` 依赖 `country`。
- `benefitCoverage` 依赖 `monthlySalary`。
- `taxId` 依赖 `country`。
- 依赖字段变化后，如果依赖项已被触碰，会自动重新校验；提交时会强制校验全部活动字段。

异步字段：`username`、`email`、`registrationProof`，均在 Web Worker 中模拟远端请求。

## 异步竞态

每个请求都有唯一 `requestId`，并计算字段及其依赖值的签名：

1. 新请求开始时，取消字段集合重叠的旧 Worker 请求。
2. `VALIDATION_STARTED` 原子移除同字段旧任务。
3. Worker 返回后，解释器再次确认请求仍存在且值签名未变化。
4. reducer 也忽略未知 `requestId` 的迟到结果，形成四层防护。
5. 提交使用独立 `submitId`，迟到提交结果不能覆盖新状态。

页面上的“放大异步校验延迟”开关用于快速连续输入并观察取消行为。

## 恢复与分享

- 自动防抖保存到 IndexedDB，刷新后从最近草稿恢复。
- 保存前会移除 `AbortController` 等不可序列化对象，仅保留任务元数据；恢复时任务状态回到 `idle`。
- 成功页、当前步骤、分支、两个分支的字段和错误均可恢复。
- “复制分享链接”把清理后的快照放入 `#draft=`。接收者打开后会复制成新的 `draftId`，不会覆盖本地草稿。
- “导出/导入 JSON”使用同一序列化快照协议。

## 验收对应

- 任意步骤刷新可恢复：IndexedDB 保存完整快照，启动时恢复 `currentStep/values/errors/status/result`。
- 分支切换不丢数据：两个分支字段共存，切换只改变路由和当前分支。
- 异步校验无竞态：Worker abort、字段任务替换、值签名、requestId 四层约束。
- 草稿可分享：URL hash 和 JSON 都使用 `sanitizeSnapshot` 后的快照。
- 状态机可序列化：纯事件 reducer，快照中无函数、Promise、Controller 或 AbortController。
