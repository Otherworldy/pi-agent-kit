# /continue 失败恢复计划

## 背景

用户希望在 pi-agent 对话连续出错并停止后，通过 `/continue` 命令从失败位置自动重试并继续对话。

代码扫描结论：
- 插件入口是 `src/index.ts`，已有 `/agent-kit` 和 `/fast` 两个命令。
- `/fast` 的命令注册、处理函数和 smoke 测试可以作为新增 slash command 的参考。
- 运行期状态集中在 `src/plugin-state.ts` 的 `PluginState`。
- 已有 `agent_end` 事件用于任务结束通知，通知逻辑能识别 assistant `stopReason: "error"` 等失败状态。
- pi-agent 核心已有自动重试语义，但插件命令上下文没有公开“删除最后错误 assistant 并直接 continue”的 API。

## 实现方案

在插件内增加 `/continue` 命令：当最近一次 `agent_end` 是错误状态时，记录最后失败 assistant 消息的快照；用户执行 `/continue` 后，插件通过公开的 `pi.sendMessage(..., { triggerTurn: true })` 发送一条内部 custom message 来触发新一轮请求，并在下一次 `context` 事件里一次性过滤掉：

- 上一次失败的 assistant error 消息。
- 插件内部用于触发本轮的 custom message。

这样发给模型的上下文会回到失败请求之前，语义接近 pi-agent 内部 auto-retry 的 `agent.continue()`，但不依赖私有 API，也不修改 `node_modules`。

需要明确的限制：session 历史里仍会保留失败记录和 `/continue` 的内部触发记录；过滤只作用于下一次 provider 请求。若未来 pi-agent 暴露正式的 command-context `retryLastError()` / `continue()` API，可再把实现替换为直接调用核心能力。

## 修改文件

- `src/continue-mode.ts`：新增 `/continue` 的纯逻辑，包括可继续错误判定、失败指纹、内部 trigger 消息和 context 过滤。
- `src/index.ts`：注册 `/continue`，处理命令逻辑；在 `agent_end` 中记录/清除失败状态；新增 `context` hook 做一次性上下文过滤。
- `src/plugin-state.ts`：增加最后失败状态、继续请求状态等字段。
- `tests/smoke.test.ts`：扩展命令注册和 `/continue` 行为测试。
- `README.md`：补充 `/continue` 使用说明。

## 复用点

- `src/index.ts` 的 `pi.registerCommand("fast", ...)` 和 `handleFastCommand` 结构。
- `src/notify.ts` 的 `getTaskCompletionNotificationStatus()` 错误分类逻辑。
- pi-agent 公共 API：`pi.sendMessage()` 可用 custom message + `triggerTurn` 启动一轮 agent；`context` 事件可返回替换后的 `messages`。
- pi-agent 现有自动重试语义：核心在 retryable error 后会移除最后 assistant error 并调用内部 `agent.continue()`。
- `tests/smoke.test.ts` 中现有 command harness 与 `runCommand` 工具。

## 执行步骤

- [x] 查清 pi-agent extension API 是否有 resume/retry/submit prompt 的能力，以及命令 handler 的 `ctx` 是否可访问对话历史或输入提交接口。
- [x] 确定不修改 pi-agent 内部包，使用公开 `pi.sendMessage()` + `context` hook 复刻失败前上下文。
- [x] 定义 `/continue` 的准确语义：只在最近一次错误后可用；成功继续后清空失败状态；如果没有可继续的失败则提示用户。
- [x] 在 `PluginState` 增加失败恢复状态字段：最近失败、pending continue 请求、请求 id。
- [x] 在 `agent_end` 事件中记录最后错误 assistant；非错误结束时清空失败状态和 pending 请求。
- [x] 注册并实现 `/continue` 命令，包含空状态提示、正在运行/重复触发保护、用户可见通知。
- [x] 新增 `context` 事件处理：识别内部 continue trigger，过滤失败 assistant + trigger message，并只生效一次。
- [x] 增加 smoke 覆盖命令注册、无失败提示、运行中保护、失败后触发、context 过滤、重复执行保护。
- [x] 更新 README。

## 验证

- [x] `npm run check`
- [x] `npm test`
- [x] `npm run smoke`

## 决策

- `/continue` 只覆盖 assistant/provider 层错误（`stopReason: "error"`、有 `errorMessage`、或非 `stop/toolUse` 的异常 stopReason），不覆盖用户中断 `aborted`。
- `/continue` 每次只触发一次手动继续；如果继续后再次连续失败，用户可以再次执行 `/continue`。
- session 历史里允许保留一条内部 custom trigger 记录；它不会进入下一次模型上下文，但会作为插件操作痕迹留在 JSONL 里。若要求历史完全无痕，需要 pi-agent 核心暴露正式 retry/continue API。
