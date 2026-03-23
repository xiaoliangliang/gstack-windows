# Support

## Best Place to Ask for Help

For normal usage questions, installation trouble, or Windows-specific behavior, please open a GitHub issue.

Before filing, it is worth checking:

- `docs/QUICKSTART-WINDOWS.md`
- `docs/AUTHENTICATED-BROWSING.md`
- `docs/COMPATIBILITY-WINDOWS.md`
- `docs/FAQ.md`
- `docs/TROUBLESHOOTING-WINDOWS.md`

## Please Include

- your OS version
- whether you are using Codex or Claude-compatible fallback paths
- whether you installed globally or vendored the repo into a project
- PowerShell vs Git Bash
- the exact command you ran
- the exact output or screenshot

## Typical Problem Categories

- `setup.ps1` failed
- `browse` binary not found
- login-session does not persist
- cookie import reports a Windows encryption limitation
- Chrome opens but authenticated pages still redirect to login
- Douyin / other sites trigger captcha or anti-bot after login reuse

## Before Filing

Please try:

```powershell
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

And if the issue is with direct cookie import on Windows, also try the supported fallback:

```powershell
browse login-session headed https://target-site.com
```

Then sign in manually once and switch to:

```powershell
browse login-session headless
```

If possible, also include the output of:

```powershell
powershell -ExecutionPolicy Bypass -File .\doctor.ps1
```
