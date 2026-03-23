# Windows Troubleshooting

## `browse` is not found

Run:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\setup.ps1"
```

Then check:

```powershell
powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\.codex\skills\gstack\doctor.ps1"
```

## Cookie import says Chrome / Edge cannot be decrypted

That usually means app-bound cookie encryption is active.

Use:

```powershell
browse login-session headed https://target-site.com/
```

Then sign in manually once and switch to:

```powershell
browse login-session headless
```

## Headless session works, then the site asks to log in again

Possible causes:

- anti-bot checks
- expired account session
- CAPTCHA
- site binds auth more tightly to the headed browser state

Try:

- re-running `browse login-session headed ...`
- keeping the session headed for that site
- reducing automation intensity and checking for captcha

## `setup.ps1` fails

Check:

- Git is installed
- Bun is installed
- Node.js is installed
- the install directory is writable

The fastest diagnosis is:

```powershell
powershell -ExecutionPolicy Bypass -File .\doctor.ps1
```

If you are unsure whether the limitation is expected or a bug, compare against:

- [Windows Compatibility Matrix](COMPATIBILITY-WINDOWS.md)
- [FAQ](FAQ.md)
