import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { EditorChromeDisplayConfig, EditorChromeSlot } from "./config.ts";

const GIT_CACHE_MS = 2000;
const MIN_CHROME_WIDTH = 16;
const BODY_TOP_PADDING = 1;
const BODY_META_GAP = 1; // gap between input body and bottom meta
const PANEL_BOTTOM_PADDING = 1; // gap under meta before panel edge
const PAD_X = 1; // equal inset after left bar / before right edge
const LEFT_BAR = "▌";
// Solid mid-gray panel when theme bg is unavailable.
const FALLBACK_PANEL_BG_ANSI = "\x1b[48;2;51;51;51m";
const PANEL_BG_KEYS = ["selectedBg", "userMessageBg"] as const;

type ThemeLike = {
  fg?: (color: ThemeColor, text: string) => string;
  bg?: (color: never, text: string) => string;
  getBgAnsi?: (color: never) => string;
};

export interface EditorChromeContextLike {
  cwd?: string;
  model?: { contextWindow?: number; id?: string; name?: string; provider?: string };
  ui?: { theme?: ThemeLike };
  getContextUsage?: () => { percent?: number | null; contextWindow?: number; tokens?: number | null } | undefined;
  sessionManager?: {
    getEntries?: () => Array<{ type?: string; customType?: string; details?: any; message?: any }>;
  };
}

export interface EditorChromeRenderInput {
  width: number;
  enabled: boolean;
  context: EditorChromeContextLike | null | undefined;
  thinkingLevel: string;
  providerCompatLabel?: string;
  fastLabel?: string;
  /** Last/live working elapsed text for the `timer` chrome slot, e.g. `12s`. */
  workingElapsedLabel?: string;
  showGitStatus?: boolean;
  showProjectDir?: boolean;
  /** Meta layout: left/right slot lists (order = display order). */
  display?: EditorChromeDisplayConfig;
  /** Left-outside working label, e.g. "⠋ working". Empty when idle. */
  workingLabel?: string;
  /** Pi editor border: thinking level, or green in bash (!) mode. */
  borderColor?: (text: string) => string;
  renderBase: (width: number) => string[];
}

interface GitInfo {
  branch: string | null;
  changedFiles: number;
  added: number;
  removed: number;
  isRepository: boolean;
}

let gitCache: { cwd: string; at: number; info: GitInfo } | undefined;

export function clearEditorChromeGitCache(): void {
  gitCache = undefined;
}

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 500,
    }).trim();
  } catch {
    return "";
  }
}

function getGitInfo(cwd: string): GitInfo {
  const now = Date.now();
  if (gitCache && gitCache.cwd === cwd && now - gitCache.at < GIT_CACHE_MS) return gitCache.info;

  const isRepository = runGit(cwd, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (!isRepository) {
    const info = { branch: null, changedFiles: 0, added: 0, removed: 0, isRepository };
    gitCache = { cwd, at: now, info };
    return info;
  }

  const branch = runGit(cwd, ["branch", "--show-current"])
    || runGit(cwd, ["rev-parse", "--short", "HEAD"])
    || null;
  const porcelain = runGit(cwd, ["status", "--short"]);
  const changedFiles = porcelain ? porcelain.split("\n").filter(Boolean).length : 0;
  const numstat = [runGit(cwd, ["diff", "--numstat"]), runGit(cwd, ["diff", "--cached", "--numstat"])]
    .filter(Boolean)
    .join("\n");
  let added = 0;
  let removed = 0;

  for (const line of numstat.split("\n")) {
    const [addedText, removedText] = line.split("\t");
    const addedCount = Number(addedText);
    const removedCount = Number(removedText);
    if (Number.isFinite(addedCount)) added += addedCount;
    if (Number.isFinite(removedCount)) removed += removedCount;
  }

  const info = { branch, changedFiles, added, removed, isRepository };
  gitCache = { cwd, at: now, info };
  return info;
}

function stripOscSequences(line: string): string {
  return line.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
}

function stripAnsi(line: string): string {
  return stripOscSequences(line).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function isEditorRule(line: string): boolean {
  const plain = stripAnsi(line).trim();
  return plain.includes("─") && [...plain].every((char) => "─↑↓ 0123456789more".includes(char));
}

function splitEditorRender(lines: string[]): { bodyLines: string[]; popupLines: string[] } | null {
  if (lines.length < 2 || !isEditorRule(lines[0] ?? "")) return null;

  const withoutTop = lines.slice(1);
  let bottomRuleIndex = -1;
  for (let index = withoutTop.length - 1; index >= 0; index -= 1) {
    if (isEditorRule(withoutTop[index] ?? "")) {
      bottomRuleIndex = index;
      break;
    }
  }
  if (bottomRuleIndex === -1) return null;

  return {
    bodyLines: withoutTop.slice(0, bottomRuleIndex),
    popupLines: withoutTop.slice(bottomRuleIndex + 1),
  };
}

function fg(theme: ThemeLike | undefined, color: ThemeColor, text: string): string {
  try {
    return theme?.fg?.(color, text) ?? text;
  } catch {
    return text;
  }
}

function panelBgOpen(theme: ThemeLike | undefined): string {
  for (const key of PANEL_BG_KEYS) {
    try {
      const ansi = theme?.getBgAnsi?.(key as never);
      if (ansi && ansi !== "\x1b[49m") return ansi;
    } catch {
      // try next / fallback
    }
  }
  return FALLBACK_PANEL_BG_ANSI;
}

// Full-line panel fill. Re-open bg after full SGR resets (editor cursor uses \x1b[0m).
function withPanelBg(theme: ThemeLike | undefined, text: string): string {
  const open = panelBgOpen(theme);
  const repaired = text.replace(/\x1b\[0m/g, `\x1b[0m${open}`);
  return `${open}${repaired}\x1b[49m`;
}

function thinkingColor(level: string): ThemeColor {
  switch (level) {
    case "minimal":
      return "thinkingMinimal";
    case "low":
      return "thinkingLow";
    case "medium":
      return "thinkingMedium";
    case "high":
      return "thinkingHigh";
    case "xhigh":
      return "thinkingXhigh";
    case "max":
      return "thinkingMax";
    case "off":
    default:
      return "thinkingOff";
  }
}

function compactModelId(modelId: string, maxWidth: number): string {
  if (visibleWidth(modelId) <= maxWidth) return modelId;

  const slashIndex = modelId.indexOf("/");
  const prefix = slashIndex === -1 ? "" : modelId.slice(0, slashIndex + 1);
  const id = slashIndex === -1 ? modelId : modelId.slice(slashIndex + 1);
  const simplifiedId = id
    .replace(/^claude-/, "")
    .replace(/^gpt-/, "")
    .replace(/-20\d{6}$/, "")
    .replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const simplified = `${prefix}${simplifiedId}`;

  if (visibleWidth(simplified) <= maxWidth) return simplified;
  return truncateToWidth(simplified, maxWidth, "…");
}

function modelChromeLabel(context: EditorChromeContextLike): string {
  const modelId = context.model?.name ?? context.model?.id ?? "model unknown";
  return context.model?.provider ? `${context.model.provider}/${modelId}` : modelId;
}

function formatGitLabel(theme: ThemeLike | undefined, git: GitInfo, maxWidth: number): string {
  const contentWidth = Math.max(0, maxWidth);
  if (contentWidth === 0) return "";

  if (!git.isRepository) return "";
  if (!git.branch && git.changedFiles === 0) return "";

  const separator = fg(theme, "dim", " · ");
  const branch = git.branch ? `${fg(theme, "accent", "⑂")} ${fg(theme, "muted", git.branch)}` : "";
  const compactStatus = git.changedFiles === 0
    ? fg(theme, "success", "✓")
    : `${fg(theme, "warning", "●")} ${fg(theme, "warning", `${git.changedFiles}Δ`)}`;
  const fullStatus = git.changedFiles === 0
    ? `${fg(theme, "success", "✓")} ${fg(theme, "success", "clean")}`
    : [
      compactStatus,
      git.added > 0 ? fg(theme, "toolDiffAdded", `+${git.added}`) : "",
      git.removed > 0 ? fg(theme, "toolDiffRemoved", `-${git.removed}`) : "",
    ].filter(Boolean).join(" ");

  const fullLabel = branch ? `${branch}${separator}${fullStatus}` : fullStatus;
  if (visibleWidth(fullLabel) <= contentWidth) return fullLabel;

  const compactLabel = branch ? `${branch}${separator}${compactStatus}` : compactStatus;
  if (visibleWidth(compactLabel) <= contentWidth) return compactLabel;

  if (branch) {
    const branchWidth = contentWidth - visibleWidth(separator) - visibleWidth(compactStatus);
    if (branchWidth > 0) return `${truncateToWidth(branch, branchWidth, "…")}${separator}${compactStatus}`;
  }

  if (visibleWidth(fullStatus) <= contentWidth) return fullStatus;
  if (visibleWidth(compactStatus) <= contentWidth) return compactStatus;

  return truncateToWidth(compactStatus, contentWidth, "…");
}

function padLine(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

// Shared light tone for model / ctx / provider-compat meta items.
const META_LIGHT: ThemeColor = "muted";

const DEFAULT_DISPLAY: EditorChromeDisplayConfig = {
  left: ["model", "thinking", "timer", "providerCompat", "fast"],
  right: ["cost", "context"],
};

function resolveDisplay(partial?: EditorChromeDisplayConfig): EditorChromeDisplayConfig {
  if (!partial) return { left: [...DEFAULT_DISPLAY.left], right: [...DEFAULT_DISPLAY.right] };
  return {
    left: Array.isArray(partial.left) ? [...partial.left] : [...DEFAULT_DISPLAY.left],
    right: Array.isArray(partial.right) ? [...partial.right] : [...DEFAULT_DISPLAY.right],
  };
}

/** Match pi footer token formatting. */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(count);
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** e.g. 34k/500k */
function formatContextUsage(context: EditorChromeContextLike, theme: ThemeLike | undefined): string {
  try {
    const usage = context.getContextUsage?.();
    if (!usage) return "";

    const contextWindow = usage.contextWindow ?? context.model?.contextWindow;
    const windowText = contextWindow && contextWindow > 0 ? formatTokenCount(contextWindow) : "?";
    const tokens = usage.tokens;

    if (tokens === null || tokens === undefined) {
      return fg(theme, META_LIGHT, `?/${windowText}`);
    }

    return fg(theme, META_LIGHT, `${formatTokenCount(Math.max(0, tokens))}/${windowText}`);
  } catch {
    return "";
  }
}

/** Subagent costs live in toolResult / slash custom_message details, not assistant usage. */
function subagentDetailsFromEntry(entry: {
  type?: string;
  customType?: string;
  details?: any;
  message?: any;
}): { results?: Array<{ usage?: { cost?: number } }>; totalChildUsage?: { cost?: number }; totalCost?: { costUsd?: number } } | undefined {
  if (entry.type === "custom_message" && entry.customType === "subagent-slash-result") {
    const details = entry.details?.result?.details;
    return details && Array.isArray(details.results) ? details : undefined;
  }
  if (entry.type === "message" && entry.message?.role === "toolResult" && entry.message?.toolName === "subagent") {
    const details = entry.message.details;
    return details && Array.isArray(details.results) ? details : undefined;
  }
  return undefined;
}

function subagentChildCost(details: NonNullable<ReturnType<typeof subagentDetailsFromEntry>>): number {
  if (typeof details.totalCost?.costUsd === "number" && Number.isFinite(details.totalCost.costUsd)) {
    return details.totalCost.costUsd;
  }
  if (typeof details.totalChildUsage?.cost === "number" && Number.isFinite(details.totalChildUsage.cost)) {
    return details.totalChildUsage.cost;
  }
  let sum = 0;
  for (const result of details.results ?? []) {
    const cost = result?.usage?.cost;
    if (typeof cost === "number" && Number.isFinite(cost)) sum += cost;
  }
  return sum;
}

function formatSessionCost(context: EditorChromeContextLike, theme: ThemeLike | undefined): string {
  try {
    const entries = context.sessionManager?.getEntries?.() ?? [];
    let total = 0;
    for (const entry of entries) {
      if (entry.type === "message" && entry.message?.role === "assistant") {
        const cost = entry.message?.usage?.cost?.total;
        if (typeof cost === "number" && Number.isFinite(cost)) total += cost;
      }
      const details = subagentDetailsFromEntry(entry);
      if (details) total += subagentChildCost(details);
    }
    return fg(theme, META_LIGHT, `$${total.toFixed(3)}`);
  } catch {
    return "";
  }
}

function packLeftRight(left: string, right: string, width: number): string {
  if (!right) return padLine(left, width);
  if (!left) {
    const pad = Math.max(0, width - visibleWidth(right));
    return `${" ".repeat(pad)}${right}`;
  }

  let leftText = left;
  if (visibleWidth(leftText) + 1 + visibleWidth(right) > width) {
    leftText = truncateToWidth(leftText, Math.max(0, width - visibleWidth(right) - 1), "…");
  }
  if (!leftText) {
    const pad = Math.max(0, width - visibleWidth(right));
    return `${" ".repeat(pad)}${right}`;
  }

  const gap = Math.max(1, width - visibleWidth(leftText) - visibleWidth(right));
  return `${leftText}${" ".repeat(gap)}${right}`;
}

function renderChromeSlot(
  slot: EditorChromeSlot,
  context: EditorChromeContextLike,
  theme: ThemeLike | undefined,
  thinkingLevel: string,
  width: number,
  providerCompatLabel?: string,
  fastLabel?: string,
  workingElapsedLabel?: string,
): string {
  switch (slot) {
    case "model":
      return fg(theme, META_LIGHT, compactModelId(modelChromeLabel(context), Math.max(1, width)));
    case "thinking": {
      const thinkingText = thinkingLevel || "off";
      return thinkingText === "off" ? "" : fg(theme, thinkingColor(thinkingText), thinkingText);
    }
    case "timer":
      return workingElapsedLabel ? fg(theme, META_LIGHT, workingElapsedLabel) : "";
    case "providerCompat":
      return providerCompatLabel ? fg(theme, META_LIGHT, providerCompatLabel) : "";
    case "fast":
      return fastLabel ? fg(theme, fastLabel.includes("*") ? "warning" : "accent", fastLabel) : "";
    case "context":
      return formatContextUsage(context, theme);
    case "cost":
      return formatSessionCost(context, theme);
    default:
      return "";
  }
}

function buildMetaLine(
  context: EditorChromeContextLike,
  thinkingLevel: string,
  width: number,
  display: EditorChromeDisplayConfig,
  providerCompatLabel?: string,
  fastLabel?: string,
  workingElapsedLabel?: string,
): string {
  const theme = context.ui?.theme;
  const separator = fg(theme, "dim", " · ");
  const render = (slot: EditorChromeSlot) => renderChromeSlot(
    slot,
    context,
    theme,
    thinkingLevel,
    width,
    providerCompatLabel,
    fastLabel,
    workingElapsedLabel,
  );

  const leftParts = display.left.map(render).filter(Boolean);
  const rightParts = display.right.map(render).filter(Boolean);

  let left = leftParts.join(separator);
  let right = rightParts.join(separator);

  // Drop trailing left extras first when tight.
  while (leftParts.length > 1 && visibleWidth(left) + (right ? 1 + visibleWidth(right) : 0) > width) {
    leftParts.pop();
    left = leftParts.join(separator);
  }
  // Then drop leading right extras (keep later right slots like context).
  while (rightParts.length > 1 && visibleWidth(left) + 1 + visibleWidth(right) > width) {
    rightParts.shift();
    right = rightParts.join(separator);
  }

  return packLeftRight(left, right, width);
}

/** Current project folder name, e.g. `pi-agent-kit`. */
function formatProjectDirLabel(theme: ThemeLike | undefined, cwd: string, maxWidth: number): string {
  const name = basename(cwd) || cwd;
  const label = fg(theme, META_LIGHT, name);
  if (visibleWidth(label) <= maxWidth) return label;
  return truncateToWidth(label, Math.max(0, maxWidth), "…");
}

/** Status row outside the input panel: working (left) · projectDir + git (right). */
function buildExternalStatusLine(
  context: EditorChromeContextLike,
  width: number,
  options: { showGitStatus?: boolean; showProjectDir?: boolean; workingLabel?: string },
): string {
  const theme = context.ui?.theme;
  const working = options.workingLabel?.trim() ? options.workingLabel.trim() : "";
  const git = options.showGitStatus
    ? formatGitLabel(theme, getGitInfo(context.cwd ?? process.cwd()), width)
    : "";
  const separator = fg(theme, "dim", " · ");
  const projectDir = options.showProjectDir
    ? formatProjectDirLabel(
      theme,
      context.cwd ?? process.cwd(),
      git ? Math.max(0, width - visibleWidth(git) - visibleWidth(separator)) : width,
    )
    : "";
  const right = [projectDir, git].filter(Boolean).join(separator);

  if (!working && !right) return "";
  if (!right) return padLine(working, width);
  if (!working) {
    const pad = Math.max(0, width - visibleWidth(right));
    return " ".repeat(pad) + right;
  }

  const gap = Math.max(1, width - visibleWidth(working) - visibleWidth(right));
  return padLine(`${working}${" ".repeat(gap)}${right}`, width);
}

function paintPanelLine(
  theme: ThemeLike | undefined,
  thinkingLevel: string,
  content: string,
  contentWidth: number,
  borderColor?: (text: string) => string,
): string {
  // borderColor = thinking rail, or green when Pi is in bash (!) mode.
  const bar = borderColor
    ? borderColor(LEFT_BAR)
    : fg(theme, thinkingColor(thinkingLevel || "off"), LEFT_BAR);
  const pad = " ".repeat(PAD_X);
  // ▌ | pad | content | pad — equal inset under solid panel bg; no ─ borders
  return withPanelBg(theme, bar + pad + padLine(content, contentWidth) + pad);
}

export function renderEditorChrome(input: EditorChromeRenderInput): string[] {
  const width = Math.max(1, Math.floor(input.width));
  if (!input.enabled || !input.context || width < MIN_CHROME_WIDTH) return input.renderBase(input.width);

  const barWidth = visibleWidth(LEFT_BAR);
  const contentWidth = Math.max(1, width - barWidth - PAD_X * 2);
  // Base editor still draws ─ rules; strip them (no chrome ─ borders).
  const baseLines = input.renderBase(contentWidth);
  const split = splitEditorRender(baseLines);
  if (!split) return input.renderBase(input.width);

  const theme = input.context.ui?.theme;
  const thinkingLevel = input.thinkingLevel || "off";
  const paint = (content: string) => paintPanelLine(theme, thinkingLevel, content, contentWidth, input.borderColor);
  const topPad = Array.from({ length: BODY_TOP_PADDING }, () => paint(""));
  const metaGap = Array.from({ length: BODY_META_GAP }, () => paint(""));
  const bottomPad = Array.from({ length: PANEL_BOTTOM_PADDING }, () => paint(""));
  const display = resolveDisplay(input.display);
  const meta = buildMetaLine(
    input.context,
    thinkingLevel,
    contentWidth,
    display,
    input.providerCompatLabel,
    input.fastLabel,
    input.workingElapsedLabel,
  );
  const externalStatus = buildExternalStatusLine(input.context, width, {
    showGitStatus: input.showGitStatus,
    showProjectDir: input.showProjectDir,
    workingLabel: input.workingLabel,
  });

  return [
    ...topPad,
    ...split.bodyLines.map((line) => paint(line)),
    ...metaGap,
    paint(meta),
    ...bottomPad,
    ...(externalStatus ? [externalStatus] : []),
    ...split.popupLines.map((line) => padLine(line, width)),
  ];
}
