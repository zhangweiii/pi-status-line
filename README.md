# pi-status-line

A pi package that provides a natural-language configurable multi-line status line.

## Included resource

- `extensions/status-line.ts`

## Install

### Local path

```bash
pi install /absolute/path/to/pi-status-line
```

### npm

```bash
pi install npm:@zhangweiii/pi-status-line
```

### GitHub

```bash
pi install git:github.com/zhangweiii/pi-status-line
```

## Features

- Multi-line footer rendering
- Rich status widgets for model, git, tokens, context, session, and environment
- `/statusline` command for natural-language configuration
- `configure_statusline` tool for LLM-driven layout updates
- Persistent layout config stored under the pi agent directory

## Commands

- `/statusline` — show help, presets, and available widgets
- `/statusline reset` — reset to the default layout
- `/statusline <natural language request>` — update the layout with natural language

Examples:

```text
/statusline 切成双排平衡布局
/statusline 第一排模型、分支、上下文，第二排费用、today、month、时长
/statusline show git branch, cost, and context usage
/statusline reset
```

## Presets

- `single-line-balanced`
- `two-line-balanced`
- `two-line-compact`
- `three-line-detailed`

Default layout:

- row 1: `model`, `thinking`, `git-branch`, `git-files`, `context-pct`, `context-left`
- row 2: `cost`, `tokens-in`, `tokens-out`, `tokens-daily`, `tokens-monthly`, `session-clock`

## Available widgets

- Core: `model`, `thinking`
- Git: `git-branch`, `git-changes`, `git-files`, `git-insertions`, `git-deletions`, `git-root`, `git-worktree`
- Tokens: `tokens-in`, `tokens-out`, `tokens-cached`, `tokens-total`, `tokens-daily`, `tokens-monthly`, `cache-hit`
- Token speed: `speed-in`, `speed-out`, `speed-total`
- Context: `context-length`, `context-pct`, `context-left`, `context-bar`
- Session: `cost`, `session-clock`, `session-turns`, `session-name`
- Environment: `cwd`, `memory`, `terminal-width`

Token widget semantics:

- `tokens-in`, `tokens-out`, `tokens-cached`, `tokens-total`, `cost`, `session-turns` are based on the current session/branch.
- `tokens-daily` and `tokens-monthly` are aggregated across session files under the pi agent directory.
- Daily/monthly token scans are cached briefly to avoid rescanning on every render.

## Configuration

The extension saves layout config to:

- `$PI_CODING_AGENT_DIR/statusline.json`
- default: `~/.pi/agent/statusline.json`

It also reads session files from:

- `$PI_CODING_AGENT_DIR/sessions`
- default: `~/.pi/agent/sessions`

## Development

Use the package locally first:

```bash
pi install /absolute/path/to/pi-status-line
```

Then inside pi:

```text
/reload
/statusline 第一排模型、分支、上下文，第二排费用、today、month、时长
```

`configure_statusline` is primarily intended for LLM/tool-driven updates; human users will usually use `/statusline`.

## Publish

1. Check whether `package.json` → `name` is available on npm.
2. Login:

```bash
npm login
```

3. Publish:

```bash
npm publish --access public
```

After publishing, users can install it with:

```bash
pi install npm:@zhangweiii/pi-status-line
```

## Notes

- This package ships the TypeScript source directly. pi loads extensions via jiti, so a separate build step is not required.
- pi core packages are declared as `peerDependencies`, following pi package guidance.
- The extension respects `PI_CODING_AGENT_DIR` for its status line config and session scans, which makes isolated testing and non-default pi runtimes behave correctly.
