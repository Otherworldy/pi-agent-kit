import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, relative } from "node:path";
import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const GIT_CACHE_MS = 2000;
const MIN_CHROME_WIDTH = 16;
const BODY_HORIZONTAL_PADDING = 1;
const BODY_VERTICAL_PADDING = 1;

type ThemeLike = {
  fg?: (color: ThemeColor, text: string) => string;
};

export interface EditorChromeContextLike {
  cwd?: string;
  model?: { contextWindow?: number; id?: string; name?: string; provider?: string };
  ui?: { theme?: ThemeLike };
  getContextUsage?: () => { percent?: number | null; contextWindow?: number; tokens?: number | null } | undefined;
}

export interface EditorChromeRenderInput {
  width: number;
  enabled: boolean;
  context: EditorChromeContextLike | null | undefined;
  thinkingLevel: string;
  providerCompatLabel?: string;
  fastLabel?: string;
  borderColor?: (text: string) => string;
  renderBase: (width: number) => string[];
}

interface GitInfo {
  branch: string | null;
  changedFiles: number;
  added: number;
  removed: number;
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

  const info = { branch, changedFiles, added, removed };
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

function compactPath(cwd: string): string {
  const home = homedir();
  if (cwd === home) return "~";

  const homeRelative = relative(home, cwd);
  if (homeRelative && !homeRelative.startsWith("..") && !isAbsolute(homeRelative)) {
    return `~/${homeRelative.replaceAll("\\", "/")}`;
  }

  return cwd;
}

function formatGitLabel(theme: ThemeLike | undefined, git: GitInfo): string {
  if (!git.branch && git.changedFiles === 0) return "";

  const parts: string[] = [];
  if (git.branch) parts.push(`${fg(theme, "accent", "⑂")} ${fg(theme, "muted", git.branch)}`);

  if (git.changedFiles === 0) {
    parts.push(`${fg(theme, "success", "✓")} ${fg(theme, "success", "clean")}`);
  } else {
    const changes = [`${fg(theme, "warning", "●")} ${fg(theme, "warning", `${git.changedFiles}Δ`)}`];
    if (git.added > 0) changes.push(fg(theme, "toolDiffAdded", `+${git.added}`));
    if (git.removed > 0) changes.push(fg(theme, "toolDiffRemoved", `-${git.removed}`));
    parts.push(changes.join(" "));
  }

  return ` ${parts.join(fg(theme, "dim", " · "))} `;
}

function borderWithLabels(
  width: number,
  leftLabel: string,
  rightLabel: string,
  leftCorner: string,
  rightCorner: string,
  borderColor: (text: string) => string,
): string {
  const innerWidth = Math.max(0, width - 2);
  const maxRight = Math.max(0, Math.floor(innerWidth * 0.46));
  const right = truncateToWidth(rightLabel, maxRight, "…");
  const left = truncateToWidth(leftLabel, Math.max(0, innerWidth - visibleWidth(right) - 1), "…");
  const fill = Math.max(0, innerWidth - visibleWidth(left) - visibleWidth(right));

  return borderColor(leftCorner) + left + borderColor("─".repeat(fill)) + right + borderColor(rightCorner);
}

function padLine(line: string, width: number): string {
  const clipped = truncateToWidth(line, width, "");
  return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
}

function blankBodyLine(width: number): string {
  return " ".repeat(Math.max(0, width));
}

function formatContextUsage(context: EditorChromeContextLike, theme: ThemeLike | undefined): string {
  try {
    const usage = context.getContextUsage?.();
    if (!usage || usage.percent === null || usage.percent === undefined) return "";

    const percent = Math.max(0, Math.round(usage.percent));
    const contextWindow = usage.contextWindow ?? context.model?.contextWindow;
    const suffix = contextWindow ? `/${Math.round(contextWindow / 1000)}k` : "";
    return fg(theme, "muted", `ctx ${percent}%${suffix}`);
  } catch {
    return "";
  }
}

function buildTopLabels(
  context: EditorChromeContextLike,
  thinkingLevel: string,
  width: number,
  providerCompatLabel?: string,
  fastLabel?: string,
): { left: string; right: string } {
  const theme = context.ui?.theme;
  const cwd = context.cwd ?? process.cwd();
  const git = formatGitLabel(theme, getGitInfo(cwd));
  const modelLabel = modelChromeLabel(context);
  const innerWidth = Math.max(0, width - 2);
  const maxRight = Math.max(0, Math.floor(innerWidth * 0.46));
  const gitWidth = Math.min(visibleWidth(git), maxRight);
  const thinkingText = thinkingLevel || "off";
  const thinking = fg(theme, thinkingColor(thinkingText), thinkingText);
  const providerCompat = providerCompatLabel ? fg(theme, providerCompatLabel.includes("*") ? "warning" : "accent", providerCompatLabel) : "";
  const fast = fastLabel ? fg(theme, fastLabel.includes("*") ? "warning" : "accent", fastLabel) : "";
  const contextUsage = formatContextUsage(context, theme);
  const separator = fg(theme, "dim", " · ");
  const fixedParts = [thinking, providerCompat, fast, contextUsage].filter(Boolean);
  const fixedWidth = fixedParts.reduce((total, part) => total + visibleWidth(part), 0);
  const separatorWidth = visibleWidth(separator) * fixedParts.length;
  const modelMaxWidth = Math.max(1, innerWidth - gitWidth - fixedWidth - separatorWidth - 3);
  const model = fg(theme, "text", compactModelId(modelLabel, modelMaxWidth));
  const leftParts = [model, ...fixedParts];

  return {
    left: ` ${leftParts.join(separator)} `,
    right: git,
  };
}

function buildBottomLabels(context: EditorChromeContextLike): { left: string; right: string } {
  const theme = context.ui?.theme;
  const cwd = context.cwd ?? process.cwd();

  return {
    left: "",
    right: fg(theme, "muted", ` ${compactPath(cwd)} `),
  };
}

export function renderEditorChrome(input: EditorChromeRenderInput): string[] {
  const width = Math.max(1, Math.floor(input.width));
  if (!input.enabled || !input.context || width < MIN_CHROME_WIDTH) return input.renderBase(input.width);

  const paddingX = width >= BODY_HORIZONTAL_PADDING * 2 + 3 ? BODY_HORIZONTAL_PADDING : 0;
  const paddingY = BODY_VERTICAL_PADDING;
  const bodyWidth = Math.max(1, width - 2 - paddingX * 2);
  const bodyOuterWidth = bodyWidth + paddingX * 2;
  const baseLines = input.renderBase(bodyWidth);
  const split = splitEditorRender(baseLines);
  if (!split) return input.renderBase(input.width);

  const borderColor = input.borderColor ?? ((text: string) => text);
  const top = buildTopLabels(input.context, input.thinkingLevel, width, input.providerCompatLabel, input.fastLabel);
  const bottom = buildBottomLabels(input.context);
  const bodyPadding = " ".repeat(paddingX);
  const popupPadding = " ".repeat(paddingX + 1);
  const wrapBodyLine = (line: string) => `${borderColor("│")}${bodyPadding}${padLine(line, bodyWidth)}${bodyPadding}${borderColor("│")}`;
  const verticalPadding = Array.from({ length: paddingY }, () => `${borderColor("│")}${blankBodyLine(bodyOuterWidth)}${borderColor("│")}`);

  return [
    borderWithLabels(width, top.left, top.right, "╭", "╮", borderColor),
    ...verticalPadding,
    ...split.bodyLines.map(wrapBodyLine),
    ...verticalPadding,
    borderWithLabels(width, bottom.left, bottom.right, "╰", "╯", borderColor),
    ...split.popupLines.map((line) => padLine(`${popupPadding}${line}`, width)),
  ];
}
