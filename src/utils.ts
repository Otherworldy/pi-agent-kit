/**
 * 发送通知消息
 */
export function notify(ctx: any, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (typeof ctx?.ui?.notify === "function") {
    ctx.ui.notify(message, type);
  }
}

/**
 * 获取当前活动模型
 */
export function activeModel(ctx: any | undefined, currentModelRef: any): any {
  return ctx?.model ?? currentModelRef;
}
