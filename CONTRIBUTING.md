# Contributing to CF Uptime

English | [中文](CONTRIBUTING.zh-TW.md)

Thanks for your interest in contributing! This guide covers the basics.

## Development Setup

```bash
# Prerequisites: Node.js >= 22.14.0, pnpm >= 10.8.1

git clone https://github.com/ozuijoy/cf-uptime.git
cd CF Uptime
pnpm install
cp apps/worker/.dev.vars.example apps/worker/.dev.vars
pnpm dev
```

See [Develop/LOCAL-TESTING.md](Develop/LOCAL-TESTING.md) for the full local development guide.

## Making Changes

1. Create a branch from `master`
2. Make your changes, keeping them small and focused
3. Ensure quality checks pass:
   ```bash
   pnpm lint
   pnpm typecheck
   pnpm test
   pnpm format:check
   ```
4. If you changed the D1 schema, add a **new** migration file (never modify existing migrations)
5. Open a pull request

## Code Style

- TypeScript strict mode across all packages
- Formatting is handled by Prettier — run `pnpm format` before committing
- Linting rules are defined in `eslint.config.mjs`

## Architecture Notes

Before making changes, review these documents:

- [Develop/Application.md](Develop/Application.md) — Product spec and technical constraints
- [Develop/Structure.md](Develop/Structure.md) — Directory structure and module boundaries
- [AGENTS.md](AGENTS.md) — Collaboration guidelines

Key conventions:

- All API input is validated with Zod
- All DB writes use parameterized queries (Drizzle ORM)
- Shared types live in `packages/shared`, not duplicated across apps
- API routes go in `apps/worker/src/routes/` — business logic stays in domain modules

## Reporting Issues

When filing a bug report, please include:

- Steps to reproduce
- Expected vs actual behavior
- Relevant logs or error messages
- Your deployment method (local dev, GitHub Actions, manual)

## Pull Requests

- Keep PRs small and focused on a single concern
- Include a clear description of what changed and why
- Reference any related issues
- Ensure CI passes before requesting review
