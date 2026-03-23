# Authenticated Browsing on Windows

The core problem on Windows is simple:

Modern Chrome and Edge can protect default-profile cookies with app-bound encryption, which means external tools may be unable to decrypt and reuse them directly.

That is why `gstack-windows` treats persistent login sessions as the main path, not a fallback footnote.

## Two Supported Paths

### Path A: Direct cookie import

Use this when the source browser/profile still allows decryption:

```powershell
browse cookie-import-browser
```

Or:

```powershell
browse cookie-import-browser chrome --domain douyin.com
```

Best for:

- simple internal sites
- non-hardened Chromium profiles
- quick authenticated QA

### Path B: Persistent login-session

Use this when direct cookie import is blocked or unreliable:

```powershell
browse login-session headed https://target-site.com/
```

Then log in manually once and switch to:

```powershell
browse login-session headless
```

Best for:

- Douyin
- GitHub
- private staging apps
- sites with stricter bot or session checks

## Which Path Should You Choose?

| Situation | Recommended path |
|-----------|------------------|
| Cookie import works | `cookie-import-browser` |
| Chrome/Edge profile reports encryption limitation | `login-session headed` |
| Site frequently invalidates headless auth | stay on `login-session headed` when needed |
| Site uses captcha or strong anti-bot | manual login first, then try `headless` reuse |

## Douyin Notes

Douyin is a good example of why the persistent-session path matters.

- Headed login is the most reliable starting point
- Headless reuse may still trigger captcha depending on account/IP/site state
- This repo does not bypass anti-bot controls
- The intended workflow is to preserve your own legitimate login state and let Codex browse with it

## Useful Commands

```powershell
browse login-session status
browse login-session stop
browse cookies
browse console
browse screenshot
```

For hard yes/no answers about platform limits, read [Windows Compatibility Matrix](COMPATIBILITY-WINDOWS.md).
