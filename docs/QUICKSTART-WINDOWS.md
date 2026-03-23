# Windows Quickstart

This is the fastest path from zero to a logged-in browser session that Codex can reuse.

## 1. Install globally for Codex

From a local checkout:

```powershell
powershell -ExecutionPolicy Bypass -File .\install-codex-global.ps1
```

Or from the installed path later:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\doctor.ps1"
```

## 2. Verify your environment

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\doctor.ps1"
```

The doctor checks:

- Git
- Bun
- Node.js
- Git Bash
- Chrome / Edge
- active gstack install
- `browse` runtime files

## 3. Create a persistent logged-in browser session

For sites like Douyin, GitHub, or a private staging app:

```powershell
browse login-session headed https://www.douyin.com/
```

Then:

1. Sign in manually in the opened browser
2. Confirm the session is stable
3. Switch to headless reuse:

```powershell
browse login-session headless
```

## 4. Reuse that session

```powershell
browse goto https://www.douyin.com/
browse snapshot -i
browse screenshot
```

## 5. Upgrade later

```powershell
/gstack-upgrade
```

Or manually:

```powershell
git -C "$env:USERPROFILE\.codex\skills\gstack" pull --ff-only
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\setup.ps1"
```

## Need more than the quickstart?

- see [Command Recipes](COMMAND-RECIPES.md) for real workflows
- see [Windows Compatibility Matrix](COMPATIBILITY-WINDOWS.md) for hard limits
- see [FAQ](FAQ.md) for common login-state questions
- see [Windows Troubleshooting](TROUBLESHOOTING-WINDOWS.md) if the first run behaves unexpectedly
