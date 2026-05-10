# pi-footer-fixed

Pi Agent extension that keeps the editor/input cluster fixed at the bottom of the terminal while chat output scrolls above it.

Based on the Fixed editor cluster idea from [`nicobailon/pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer).

## Install

```bash
npm install
npm run validate
pi install -l D:/Study/Code/Node/pi-footer-fixed
```

## Settings UI

```text
/footer-fixed
```

Opens a settings panel with:

- Fixed editor
- Mouse scroll
- Extension status

## Settings file

Global: `~/.pi/agent/settings.json`

Project: `.pi/settings.json`

```json
{
  "footerFixed": {
    "fixedEditor": true,
    "mouseScroll": true,
    "showExtensionStatus": true
  }
}
```

`powerline.fixedEditor` and `powerline.mouseScroll` are also read as compatibility aliases.

## Notes

This is terminal/TUI code, not CSS. It uses ANSI scroll regions and a bottom compositor copied/adapted from `pi-powerline-footer` at commit `22dc838dcd5489806bbb41e0df773d2eda6fe5e1`.
