/**
 * 请求首 token 响应时间（TTFT）计量器。
 * 每个 provider 请求从发出到首个流式 delta 记一次，会话内取平均。
 */
export class TtftMeter {
  private pendingStart: number | null = null;
  private sumMs = 0;
  private count = 0;

  markRequest(now = Date.now()): void {
    this.pendingStart = now;
  }

  markFirstToken(now = Date.now()): void {
    if (this.pendingStart == null) return;
    this.sumMs += Math.max(0, now - this.pendingStart);
    this.count += 1;
    this.pendingStart = null;
  }

  /** 请求结束但没等到首 token（错误/中断）：丢弃本次，不污染平均。 */
  clearPending(): void {
    this.pendingStart = null;
  }

  reset(): void {
    this.pendingStart = null;
    this.sumMs = 0;
    this.count = 0;
  }

  getAverageMs(): number {
    return this.count === 0 ? 0 : this.sumMs / this.count;
  }
}

/** `450ms ttft` / `1.2s ttft`；尚无样本时 `0ms ttft`（slot 开启即常驻）。 */
export function formatTtftLabel(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms ttft";
  if (ms < 1000) return `${Math.round(ms)}ms ttft`;
  const sec = ms / 1000;
  const value = sec >= 10 ? String(Math.round(sec)) : sec.toFixed(1).replace(/\.0$/, "");
  return `${value}s ttft`;
}
