# opencode-tbot (customized)

A customized build of the [`opencode-tbot`](https://github.com/Shenean/opencode-tbot) Telegram plugin for [OpenCode](https://opencode.ai), used by `subirdkimo`.

## Customizations (vs. upstream 0.1.50)

- **Inline keyboards use 2 columns per row** for numbered lists (models / agents / sessions), instead of 5.
- **Todo list integration** — sending `todo` / `待辦` to the bot prints the todo list from `in-progress.md` / `backlog.md` / `done.md` as a compact 2-column grid.

## Install on a fresh OpenCode host

Requirements: Node.js `>=22.12.0`, a Telegram bot token (from `@BotFather`).

### 1. Install the plugin package

The plugin is consumed by OpenCode from `~/.config/opencode/node_modules/opencode-tbot`. Install this customized build into that location:

```sh
mkdir -p ~/.config/opencode/node_modules
git clone https://github.com/subirdkimo/opencode-tbot.git ~/.config/opencode/node_modules/opencode-tbot
cd ~/.config/opencode/node_modules/opencode-tbot
npm install --omit=dev
```

### 2. Enable the plugin in OpenCode config

Edit `~/.config/opencode/opencode.jsonc` (create it if missing):

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-tbot"]
}
```

> The repo-local `node_modules` for the plugin is installed with `npm install --omit=dev` so OpenCode can resolve its runtime dependencies (grammY, `@opencode-ai/sdk`, etc.).

### 3. Configure the plugin

Create `~/.config/opencode/opencode-tbot/config.json`:

```json
{
  "telegram": {
    "botToken": "<YOUR_BOT_TOKEN>",
    "allowedChatIds": ["<YOUR_NUMERIC_CHAT_ID>"]
  },
  "tokens": {
    "showBreakdown": false
  },
  "todo": {
    "directory": "/path/to/your/todo-repo"
  }
}
```

- `botToken`: from `@BotFather` (`/newbot`).
- `allowedChatIds`: your numeric Telegram user ID (get it from `@userinfobot`).
- `todo.directory`: directory containing `in-progress.md`, `backlog.md`, `done.md`. If omitted, defaults to `/root/opencode/todo`.

### 4. Restart OpenCode

Restart the OpenCode host process so the plugin loads. Verify it's polling:

```sh
ls ~/.local/share/opencode/log/plugins/opencode-tbot/
```

If you see `get_updates_failed`, only one long-poller can hold the bot token at a time — stop any other bot (e.g. a standalone npm bot) before starting OpenCode.

## Verify

Send `todo` to your bot — you should get a 2-column todo grid. Open the model/agent/session pickers to confirm the numbered inline buttons render 2 per row.

## Layout

- `dist/plugin.js` — customized build output (the actual code OpenCode loads)
- `package.json` — npm package metadata (name `opencode-tbot`)
- `LICENSE` — MIT
