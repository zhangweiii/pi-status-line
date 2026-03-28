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

## Features

- Multi-line footer rendering
- Rich status widgets for model, git, tokens, context, session, and environment
- `/statusline` command for natural-language configuration
- `configure_statusline` tool for LLM-driven layout updates

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
