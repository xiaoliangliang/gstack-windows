# FAQ

## Why does this fork focus so much on login-session instead of promising cookie import?

Because that is the honest Windows answer.

Modern Chrome and Edge often protect default-profile cookies with app-bound encryption. On those machines, "just import your cookies" sounds nice but fails in practice. `gstack-windows` makes the reliable path the default: sign in once in a real browser window, then let Codex reuse that saved profile.

## Where is the saved login state stored?

Per project, under:

- `.gstack/chrome-profile`
- `.gstack/browse-launch.json`

The `.gstack/` folder is automatically added to `.gitignore`.

## Does this modify my normal Chrome profile?

No. The recommended Windows flow uses a gstack-managed persistent profile inside your project rather than writing into your everyday browser profile.

## Do I need to close Chrome or Edge before using this?

Not for the persistent login-session flow.

For direct cookie import, only close the source browser if Windows reports a locked cookie database or access issue.

## What is the best path for Douyin?

Usually:

```powershell
browse login-session headed https://www.douyin.com/
```

Then log in manually once and switch to:

```powershell
browse login-session headless
```

If headless reuse starts triggering verification again, keep Douyin in headed persistent mode.

## Can this bypass CAPTCHA or anti-bot checks?

No.

This repo is for preserving and reusing a legitimate user-created session, not bypassing protections.

## Can Codex stay logged in across commands?

Yes. That is the main point of the persistent login-session flow. Once the project-local profile is saved, normal `browse` commands reuse it until you stop or replace that session.

## Will this work outside Codex?

Yes, but the repo is intentionally optimized for Codex-style skill installs and workflows. `.claude/skills/gstack` is still supported as a compatibility fallback, but the docs and scripts now prefer `.codex/skills/gstack`.

## What browsers are definitely unsupported for cookie import on Windows right now?

- Arc
- Comet

Chrome, Edge, and Brave are supported in principle, but Chrome and Edge default profiles can still be blocked by Windows encryption.

## How do I reset a broken saved session?

Start by reopening it in headed mode:

```powershell
browse login-session headed https://target-site.com/
```

If the site still behaves incorrectly, stop the session and create a fresh one:

```powershell
browse login-session stop
browse login-session headed https://target-site.com/
```
