# Contributing to claude-discord-harness

Thank you for your interest in contributing! This guide will help you get started.

## Development Setup

### Prerequisites

- Node.js 22+
- pnpm
- Claude Code CLI (installed and authenticated)
- A Discord bot token for testing

### Getting Started

```bash
git clone https://github.com/psh4607/claude-discord-harness.git
cd claude-discord-harness
pnpm install
cp .env.example .env
# Fill in your Discord bot token in .env
```

### Running Locally

```bash
# Development mode (watch + rebuild)
pnpm dev

# Production build
pnpm build

# Run tests
pnpm test
```

## Making Changes

### Branch Strategy

- Create a feature branch from `main`
- Use descriptive branch names: `feat/session-timeout`, `fix/message-split`

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>: <description>
```

**Types:**

| Type | Purpose |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Code style (formatting) |
| `refactor` | Refactoring |
| `test` | Tests |
| `chore` | Build, config, etc. |

**Examples:**

```
feat: add session timeout configuration
fix: handle empty message content in bridge
docs: update Quick Start instructions
```

## Pull Requests

1. Ensure your code builds without errors: `pnpm build`
2. Ensure tests pass: `pnpm test`
3. Fill out the PR template
4. Keep PRs focused — one feature or fix per PR

## Reporting Issues

Use the [issue templates](https://github.com/psh4607/claude-discord-harness/issues/new/choose) to report bugs or request features.

## Code Style

- TypeScript strict mode
- ESM modules (`import`/`export`)
- Prefer functional/declarative patterns over imperative code

## Questions?

Open a [discussion](https://github.com/psh4607/claude-discord-harness/discussions) or file an issue.
