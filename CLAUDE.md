# gstack-windows development

This fork is **Codex-first** and **Windows-first**.

Default active install:

```text
~/.codex/skills/gstack
```

Compatibility fallback:

```text
~/.claude/skills/gstack
```

When docs, scripts, and contributor guidance need a default path, prefer `.codex` first and mention `.claude` only as compatibility fallback.

## Commands

```bash
bun install              # install dependencies
bun test                 # full free suite
bun run test:smoke       # fast targeted smoke tests
bun run gen:skill-docs   # regenerate SKILL.md files from templates
bun run skill:check      # validate all skills
bun run ci:check         # dry-run docs + skill check + smoke tests
bun run dev <cmd>        # run CLI in dev mode
bun run build            # regenerate docs + compile browse binaries
bun run test:evals       # paid evals (~$4/run)
bun run test:e2e         # E2E only (~$3.85/run)
bun run dev:skill        # watch mode for templates
bun run eval:list
bun run eval:compare
bun run eval:summary
```

`test:evals` requires `ANTHROPIC_API_KEY`.

## Project structure

```text
gstack-windows/
├── browse/                 # browser CLI + server + tests
├── scripts/                # skill doc generator + validation tooling
├── setup-browser-cookies/  # setup skill for browser cookie import
├── qa/ qa-only/ review/    # main workflow skills
├── plan-*/ retro/ ship/    # planning + release skills
├── docs/                   # Windows-first documentation
├── assets/                 # README visuals
├── setup.ps1               # Windows runtime/bootstrap
├── doctor.ps1              # Windows environment diagnostics
├── install-codex-global.ps1
├── SKILL.md.tmpl
└── package.json
```

## Core contributor rules

- Keep `.codex/skills/gstack` as the primary install path in docs and scripts.
- Preserve `.claude/skills/gstack` only as compatibility fallback.
- Prefer persistent `login-session` flows over over-promising cookie extraction on Windows.
- If Windows has a hard limitation, state it clearly instead of hiding it behind vague errors.
- Do not edit generated `SKILL.md` files directly. Edit `.tmpl` files and regenerate.

## SKILL.md workflow

SKILL docs are generated.

1. Edit the relevant `.tmpl` file
2. Run:

```bash
bun run gen:skill-docs
bun run skill:check
```

3. Commit both the template and the generated markdown

If you add a new browse command, update `browse/src/commands.ts` and rebuild.

## Writing skill templates

`SKILL.md.tmpl` files are prompt templates, not shell scripts.

Rules:

- Use natural language for logic across steps
- Do not rely on shell variables surviving between separate code blocks
- Detect branches dynamically instead of hardcoding `main`
- Keep Bash snippets self-contained
- On Windows, remember Codex often runs PowerShell, but skill snippets may still need Git Bash

## Browser interaction

When testing sites, use `/browse` or the `browse` binary directly.

Do not build workflows around unrelated browser MCP tools. This repo's value is the fast local `browse` runtime, persistent login sessions, and project-local `.gstack/` state.

Important Windows behavior:

- persistent login profiles live in `.gstack/chrome-profile`
- runtime state lives in `.gstack/`
- `.gstack/` is auto-added to `.gitignore`
- Chrome is preferred on Windows, Edge is the fallback

## Recommended Windows dev mode

For local development, use the repo-local skill symlink flow:

```bash
bin/dev-setup
```

That lets Codex read the skill directly from your working tree.

When you are done:

```bash
bin/dev-teardown
```

## CHANGELOG style

Write changelog entries like release notes for users:

- lead with what the user can now do
- prefer plain language over implementation detail
- keep maintainer-only notes in a small separate section
- make each entry feel worth trying

## Local plans

Longer design notes and roadmap drafts can live in:

```text
~/.gstack-dev/plans/
```

Those are local-only and not meant to be committed by default.

## Updating the active install

Preferred Codex path:

```powershell
git -C "$env:USERPROFILE\.codex\skills\gstack" pull --ff-only
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\setup.ps1"
```

Claude-compatible fallback:

```powershell
git -C "$env:USERPROFILE\.claude\skills\gstack" pull --ff-only
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.claude\skills\gstack\setup.ps1"
```

For full environment diagnostics:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\doctor.ps1"
```
