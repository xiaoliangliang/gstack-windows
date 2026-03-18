# gstack-windows

`gstack-windows` is a Windows + Codex focused fork of [gstack](https://github.com/garrytan/gstack): fast browser automation, QA skills, and authenticated browsing workflows that are practical on Windows.

This fork exists for one reason: modern Chrome and Edge on Windows often protect default-profile cookies with app-bound encryption, so "just import my real browser cookies" is no longer a reliable story. This repo keeps the original gstack workflow model, but makes the Windows path explicit and usable.

## What This Fork Changes

- Makes `$CODEX_HOME` / `~/.codex/skills/gstack` the primary install path.
- Ships a real Windows bootstrap script: [`setup.ps1`](setup.ps1).
- Treats persistent Chrome login sessions as the primary Windows auth path.
- Keeps direct cookie import when the source browser/profile still allows it.
- Repoints upgrade/update flows to this repository instead of upstream.

## What Works Well On Windows

- `/browse` for navigation, screenshots, DOM inspection, forms, uploads, console logs, and network debugging
- `/setup-browser-cookies` for cookie-domain discovery and browser-session import where decryption is possible
- `browse login-session headed|headless|status|stop` for gstack-managed persistent Chrome sessions
- `/qa`, `/qa-only`, `/qa-design-review` and the planning/review/ship skills
- Git Bash + PowerShell mixed workflows inside Codex

## Important Limitations

- gstack cannot magically extract login cookies from every default Chrome/Edge profile on Windows. If app-bound cookie encryption is enabled, out-of-process cookie decryption may fail by design.
- Sites with CAPTCHA, SMS login, WebAuthn, 2FA, or aggressive bot checks may still require a manual step.
- Douyin works best with `login-session headed` after you sign in manually. Headless replay may still trigger anti-bot or captcha depending on the account, IP, and site state.
- This repo does not bypass anti-bot protections. It helps Codex reuse a legitimate logged-in browser state that you created yourself.

## Recommended Windows Auth Flow

For sites where default-browser cookie import is blocked, use the persistent login-session flow:

```powershell
browse login-session headed https://www.douyin.com/
```

1. A real Chrome window opens.
2. Sign in manually once.
3. After the session is confirmed, switch to headless reuse:

```powershell
browse login-session headless
```

4. Now regular commands reuse that saved browser state:

```powershell
browse goto https://www.douyin.com/
browse snapshot -i
browse screenshot
```

Useful helpers:

```powershell
browse login-session status
browse login-session stop
```

## Direct Cookie Import

If the source profile is decryptable, you can still use the cookie picker flow:

```powershell
browse cookie-import-browser
```

Or direct domain import:

```powershell
browse cookie-import-browser chrome --domain douyin.com
```

When Windows app-bound encryption blocks the default profile, gstack should explain the limitation instead of silently pretending it worked. In that case, switch to the persistent login-session flow above.

## Install

### Global install for Codex on Windows

```powershell
git clone https://github.com/xiaoliangliang/gstack-windows.git "$env:USERPROFILE\\.codex\\skills\\gstack"
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\\.codex\\skills\\gstack\\setup.ps1"
```

### Optional project-vendored copy

If you want the repo to travel with a project:

```powershell
New-Item -ItemType Directory -Force -Path ".codex\\skills" | Out-Null
Copy-Item "$env:USERPROFILE\\.codex\\skills\\gstack" ".codex\\skills\\gstack" -Recurse -Force
powershell -ExecutionPolicy Bypass -File ".codex\\skills\\gstack\\setup.ps1"
```

## Main Skills

- `/browse`
- `/setup-browser-cookies`
- `/qa`
- `/qa-only`
- `/qa-design-review`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/review`
- `/ship`
- `/retro`
- `/document-release`
- `/gstack-upgrade`

## Development

```bash
bun install
bun run gen:skill-docs
bun test browse/test/config.test.ts browse/test/find-browse.test.ts
```

On Windows, rebuilding the runtime shims:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

## Search-Friendly Keywords

This repo is intentionally optimized to be discoverable for searches like:

- `gstack windows`
- `codex browser automation windows`
- `chrome login session windows`
- `setup-browser-cookies windows`
- `app-bound cookie encryption codex`
- `douyin codex browser login state`

## Upstream Attribution

This project is based on [garrytan/gstack](https://github.com/garrytan/gstack) and keeps the original MIT license. The focus of this fork is Windows + Codex usability, especially authenticated browser automation and Chrome login-state reuse.
