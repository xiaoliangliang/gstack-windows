# Contributing to gstack-windows

Thanks for helping improve `gstack-windows`.

This fork is focused on one practical goal: make gstack work well in real Windows + Codex environments, especially for authenticated browser automation.

## What Contributions Are Most Helpful

- Windows install/setup fixes
- Codex-specific skill path fixes (`.codex/skills/gstack`)
- Chrome / Edge login-session improvements
- Better Windows browser-cookie diagnostics and fallbacks
- Better docs, examples, and repo polish
- New tests for Windows-specific behavior

## Quick Start

```bash
git clone https://github.com/xiaoliangliang/gstack-windows.git
cd gstack-windows
bun install
```

On Windows, build the runtime shims with:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

## Recommended Dev Mode

For Codex-focused development, use the repo-local dev symlink flow:

```bash
bin/dev-setup
```

That creates:

- `.codex/skills/gstack -> <repo root>`

So Codex reads skills straight from your working tree.

When you are done:

```bash
bin/dev-teardown
```

## Global Install Path

The preferred global install path for this fork is:

```text
~/.codex/skills/gstack
```

`.claude/skills/gstack` is still supported as a compatibility fallback, but new docs and fixes should prefer `.codex`.

## Common Workflows

### 1. Edit skill templates

Do not edit generated `SKILL.md` files directly. Edit the `.tmpl` files, then regenerate:

```bash
bun run gen:skill-docs
bun run skill:check
```

### 2. Edit browser/runtime code

If you touch `browse/src/*.ts`, rebuild and rerun the relevant tests:

```bash
bun test browse/test/find-browse.test.ts browse/test/config.test.ts
```

If you need the runtime shims rebuilt on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

### 3. Test real authenticated browsing

The main Windows flow to test is:

```powershell
browse login-session headed https://target-site.com
```

Then:

1. Sign in manually in the opened Chrome window
2. Switch to persistent headless reuse:

```powershell
browse login-session headless
```

3. Verify ordinary `browse` commands still carry the login state

This matters more than default-profile cookie extraction, because Windows app-bound cookie encryption can block direct import from real Chrome / Edge profiles.

## Testing

### Fast checks

```bash
bun run gen:skill-docs
bun run skill:check
bun test browse/test/find-browse.test.ts browse/test/config.test.ts
```

### Full test suite

```bash
bun test
```

### Playwright browser install

If Chromium is missing:

```bash
bun x playwright install chromium
```

## Versioning

This fork uses the top-level `VERSION` file for update checks. Keep these aligned when making releases:

- `VERSION`
- `package.json`
- `CHANGELOG.md`

## Pull Requests

Good PRs for this repo usually include:

- a short explanation of the Windows/Codex problem
- the chosen fix
- how you tested it
- any limitation that still remains

If the change affects authenticated browsing, call that out explicitly.

## High-Value Areas

If you want ideas, these areas are especially valuable:

- `setup.ps1`
- `browse/src/cookie-import-browser.ts`
- `browse/src/browser-manager.ts`
- `browse/src/find-browse.ts`
- `browse/bin/find-browse`
- `scripts/gen-skill-docs.ts`
- `setup-browser-cookies/`

## Before Opening a PR

Please run:

```bash
bun run gen:skill-docs
bun run skill:check
```

And if relevant:

```bash
bun test browse/test/find-browse.test.ts browse/test/config.test.ts
```

## Scope Notes

This fork is not trying to bypass anti-bot systems or break site protections.

The goal is:

- use legitimate user-created browser sessions
- preserve them reliably for Codex automation
- explain clearly when Windows makes some cookie-import paths impossible
