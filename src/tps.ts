/**
 * 流式 TPS（tokens per second）计量器。
 * 以 (时间, tokens) 样本的滑动窗口计算速率，窗口外的样本自动裁剪。
 */
export interface TpsSample {
  at: number;
  tokens: number;
}

const DEFAULT_WINDOW_MS = 5000;

export class TpsMeter {
  private readonly windowMs: number;
  private samples: TpsSample[] = [];
  /** 最近一次有效速率；无样本时冻结显示。 */
  private lastRate = 0;

  constructor(windowMs: number = DEFAULT_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  record(tokens: number, now = Date.now()): void {
    if (tokens <= 0) return;
    this.samples.push({ at: now, tokens });
    this.trim(now);
  }

  /** 流结束后清样本，保留最后速率（空闲时冻结显示）。 */
  clear(): void {
    this.samples = [];
  }

  /** 会话级重置：样本与速率全部归零。 */
  reset(): void {
    this.samples = [];
    this.lastRate = 0;
  }

  /** 窗口内 tokens / 窗口实际跨度（ms）换算为每秒。样本不足 2 个时返回最后速率。 */
  getTps(now = Date.now()): number {
    this.trim(now);
    if (this.samples.length < 2) return this.lastRate;
    const firstAt = this.samples[0]!.at;
    const spanMs = Math.max(1, now - firstAt);
    const total = this.samples.reduce((sum, sample) => sum + sample.tokens, 0);
    const rate = (total / spanMs) * 1000;
    this.lastRate = rate;
    return rate;
  }

  private trim(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.samples.length > 0 && this.samples[0]!.at < cutoff) {
      this.samples.shift();
    }
  }
}

/** 流式 delta 文本估算 token 数（chars/4，与 Pi 自身 estimateTokens 同款启发式）。 */
export function estimateDeltaTokens(delta: string): number {
  return Math.ceil(delta.length / 4);
}

/** `45.7 t/s` / `123 t/s`；空闲时为 `0 t/s`（slot 开启即常驻显示）。 */
export function formatTpsLabel(tps: number): string {
  if (!Number.isFinite(tps) || tps <= 0) return "0 t/s";
  const value = tps >= 100 ? String(Math.round(tps)) : tps.toFixed(1).replace(/\.0$/, "");
  return `${value} t/s`;
}
