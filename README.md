# claude-discord-harness

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-22%2B-green.svg)](https://nodejs.org/)

A Discord bot that maps each Discord channel to a dedicated [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session. It acts as a thin transport layer over the Claude Code harness, giving you access to hooks, MCP tools, CLAUDE.md, and all other harness features — right from Discord.

## How It Works

```
Discord Channel ──► claude-discord-harness ──► Claude Code Session
       │                     │                        │
   messages             transport                  AI agent
   slash cmds           msg queue               tools & skills
   file uploads         formatting              file I/O
```

Each Discord channel gets its own isolated Claude Code session with a dedicated workspace directory. Messages flow through a queue-based bridge that handles session lifecycle, message formatting, and tool feedback.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [pnpm](https://pnpm.io/)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- A [Discord bot token](https://discord.com/developers/applications)

> **Note:** No `ANTHROPIC_API_KEY` is needed. The Claude Agent SDK uses your local Claude Code CLI authentication.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/psh4607/claude-discord-harness.git
cd claude-discord-harness

# Install dependencies
pnpm install

# Configure environment
cp .env.example .env
# Edit .env with your Discord bot token

# Build and run
pnpm build
pnpm start
```

### Development

```bash
# Watch mode (auto-rebuild on changes)
pnpm dev

# Run tests
pnpm test
```

## Discord Commands

| Command | Description |
|---------|-------------|
| `/stop` | Stop current execution |
| `/status` | Check session status |
| `/new` | Reset session (start fresh) |
| `/compact` | Compress session context |
| `/history` | View recent chat logs |
| `/model [name]` | Change session model |
| `/instructions [text]` | Edit channel-level CLAUDE.md |
| `/skill [name]` | Run any Claude Code skill |

## Configuration

Copy `.env.example` to `.env` and fill in the values:

| Variable | Description | Default |
|----------|-------------|---------|
| `DISCORD_TOKEN` | Discord bot token | *(required)* |
| `DISCORD_CATEGORY_NAME` | Channel category the bot manages | `claude` |
| `DISCORD_REQUIRED_ROLE` | Role required to use the bot | *(everyone)* |
| `CLAUDE_MODEL` | Claude model for sessions | `claude-sonnet-4-6` |
| `DATA_DIR` | Session data storage path | `./data` |
| `ARCHIVE_RETENTION_DAYS` | Archive retention period (days) | `30` |

## Project Structure

```
src/
  index.ts              # Entry point
  bot/
    client.ts           # Discord.js client
    events.ts           # Event handlers (channelCreate/Delete, messageCreate)
    guards.ts           # Role/category validation
    commands.ts         # Slash command definitions
  session/
    bridge.ts           # Query wrapper + message queue
    pool.ts             # Per-channel session pool
    options.ts          # Query options factory
    hooks.ts            # Real-time tool feedback hooks
    logger.ts           # Chat history logger
    workspace.ts        # Workspace directory management
  tools/
    discord-mcp.ts      # Discord MCP server (13 tools)
  message/
    formatter.ts        # Markdown conversion, message splitting
    sender.ts           # Message/file sending, execution logs
  storage/
    archive.ts          # Archive on channel deletion
    retention.ts        # Move to long-term storage after 30 days
  config/
    index.ts            # Environment variables, settings
```

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)
