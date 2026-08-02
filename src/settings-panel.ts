import { Container, SettingsList, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";

import type { AgentKitBooleanSettingKey, AgentKitConfig } from "./config.ts";

export interface AgentKitSettingsPanelOptions {
  config: AgentKitConfig;
  borderColor: (text: string) => string;
  onChange: (key: AgentKitBooleanSettingKey, value: boolean) => void;
  onCancel: () => void;
}

class BorderedPanel implements Component {
  private readonly child: Component;
  private readonly borderColor: (text: string) => string;

  constructor(child: Component, borderColor: (text: string) => string) {
    this.child = child;
    this.borderColor = borderColor;
  }

  render(width: number): string[] {
    const outerWidth = Math.max(4, width);
    const innerWidth = Math.max(1, outerWidth - 4);
    const top = this.borderColor(`╭${"─".repeat(outerWidth - 2)}╮`);
    const bottom = this.borderColor(`╰${"─".repeat(outerWidth - 2)}╯`);
    const lines = this.child.render(innerWidth).map((line) => {
      const trimmed = visibleWidth(line) > innerWidth ? truncateToWidth(line, innerWidth, "…", true) : line;
      const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(trimmed)));
      return `${this.borderColor("│")} ${trimmed}${padding} ${this.borderColor("│")}`;
    });

    return [top, ...lines, bottom];
  }

  handleInput(data: string): void {
    this.child.handleInput?.(data);
  }

  invalidate(): void {
    this.child.invalidate?.();
  }
}

export class AgentKitSettingsPanel extends Container {
  private readonly settingsList: SettingsList;

  constructor(options: AgentKitSettingsPanelOptions) {
    super();

    const items = [
      {
        id: "fixedEditor",
        label: "Fixed editor",
        description: "Keep the Pi input editor fixed at the bottom; chat scrolls above it.",
        currentValue: options.config.fixedEditor ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "mouseScroll",
        label: "Mouse scroll",
        description: "Use mouse wheel / PageUp / PageDown to scroll the chat viewport above the fixed editor.",
        currentValue: options.config.mouseScroll ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "showExtensionStatus",
        label: "Extension status",
        description: "Show Pi extension status rows above the fixed editor, such as MCP and extmgr status.",
        currentValue: options.config.showExtensionStatus ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "editorChrome",
        label: "Editor chrome",
        description: "Show model, thinking level, compat, and context on the input panel meta line.",
        currentValue: options.config.editorChrome ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "showGitStatus",
        label: "Git status",
        description: "Show git branch and change summary outside the input panel at the bottom-right.",
        currentValue: options.config.showGitStatus ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "showProjectDir",
        label: "Project directory",
        description: "Show the current project folder name at the bottom-right next to git status.",
        currentValue: options.config.showProjectDir ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "notificationChannels.windowsToast.enabled",
        label: "Local task notification",
        description: "Send a Windows toast notification when the main interactive Pi Agent finishes a task.",
        currentValue: options.config.notificationChannels.windowsToast.enabled ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "notificationChannels.telegram.enabled",
        label: "Telegram task notification",
        description: "Send a Telegram push notification when the main interactive Pi Agent finishes a task.",
        currentValue: options.config.notificationChannels.telegram.enabled ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "providerCompat",
        label: "Provider compatibility",
        description: "Apply Claude Code or Codex CLI request compatibility to the active model.",
        currentValue: options.config.providerCompat.enabled ? "true" : "false",
        values: ["true", "false"],
      },
      {
        id: "fast.enabled",
        label: "Fast mode",
        description: "Request OpenAI priority service tier for allow-listed custom provider models.",
        currentValue: options.config.fast.enabled ? "true" : "false",
        values: ["true", "false"],
      },
    ];

    this.settingsList = new SettingsList(
      items,
      items.length,
      getSettingsListTheme(),
      (id, newValue) => options.onChange(id as AgentKitBooleanSettingKey, newValue === "true"),
      options.onCancel,
    );
    this.addChild(new BorderedPanel(this.settingsList, options.borderColor));
  }

  handleInput(data: string): void {
    this.settingsList.handleInput(data);
  }

  invalidate(): void {
    this.settingsList.invalidate();
  }
}

export function showAgentKitSettingsPanel(
  ctx: any,
  config: AgentKitConfig,
  onChange: (key: AgentKitBooleanSettingKey, value: boolean) => void,
): Promise<void> {
  return ctx.ui.custom((_tui: any, theme: Theme, _keybindings: any, done: () => void) => {
    const panel = new AgentKitSettingsPanel({
      config,
      borderColor: (text) => theme.fg("border", text),
      onChange,
      onCancel: done,
    });

    return panel;
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: 64,
      maxHeight: 20,
    },
  });
}
