import type { ReadonlyFooterDataProvider } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { copyToClipboard } from "@earendil-works/pi-coding-agent";

/**
 * 发送通知消息
 */
export function notify(ctx: any, message: string, type: "info" | "warning" | "error" = "info"): void {
  if (typeof ctx?.ui?.notify === "function") {
    ctx.ui.notify(message, type);
  }
}

/**
 * 渲染页脚数据行（Git分支和扩展状态）
 */
export function renderFooterDataLines(
  width: number,
  footerData: ReadonlyFooterDataProvider | null,
  showExtensionStatus: boolean,
): string[] {
  if (!showExtensionStatus || !footerData || width <= 0) return [];

  const parts: string[] = [];
  const branch = footerData.getGitBranch();
  if (branch) parts.push(` ${branch}`);

  for (const value of footerData.getExtensionStatuses().values()) {
    if (value && visibleWidth(value) > 0) parts.push(value);
  }

  if (parts.length === 0) return [];
  return [truncateToWidth(` ${parts.join("  ")}`, width, "…", true)];
}

/**
 * 在TUI的children中查找包含指定子元素的容器
 */
export function findContainerWithChild(tui: any, child: any): { container: any; index: number } | null {
  const children = Array.isArray(tui?.children) ? tui.children : [];
  const index = children.findIndex((candidate: any) => Array.isArray(candidate?.children) && candidate.children.includes(child));
  if (index === -1) return null;

  return { container: children[index], index };
}

/**
 * 获取容器的唯一子元素
 */
export function getSingleContainerChild(container: any): any | null {
  const children = Array.isArray(container?.children) ? container.children : [];
  return children.length === 1 ? children[0] : null;
}

/**
 * 检查编辑器shell是否处于活动状态
 */
export function isEditorShellActive(container: any, editor: any): boolean {
  return getSingleContainerChild(container) === editor;
}

/**
 * 检查TUI是否有可见的覆盖层
 */
export function hasVisibleOverlay(tui: any): boolean {
  if (typeof tui?.hasOverlay === "function") {
    try {
      if (tui.hasOverlay()) return true;
    } catch {
      return false;
    }
  }

  const overlayStack = Reflect.get(tui ?? {}, "overlayStack");
  return Array.isArray(overlayStack) && overlayStack.some((entry) => entry && entry.hidden !== true);
}

/**
 * 复制文本到剪贴板
 */
export function copyTextToClipboard(ctx: any, text: string): void {
  void copyToClipboard(text).then(
    () => notify(ctx, "Copied selection", "info"),
    (error) => notify(ctx, `Copy failed: ${error instanceof Error ? error.message : String(error)}`, "warning"),
  );
}

/**
 * 获取当前活动模型
 */
export function activeModel(ctx: any | undefined, currentModelRef: any): any {
  return ctx?.model ?? currentModelRef;
}
