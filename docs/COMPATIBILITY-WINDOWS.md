# Windows Compatibility Matrix

This page is the honest answer to "what actually works on Windows + Codex?"

## Cookie Import Source Browser Support

`browse cookie-import-browser` reads cookies from a real browser profile when that profile is readable and decryptable.

| Source browser | Windows support | Notes |
|---|---|---|
| Chrome | Partial | Supported in code, but many modern default profiles are blocked by app-bound encryption |
| Edge | Partial | Same limitation as Chrome on many Windows setups |
| Brave | Partial | Often better than default Chrome/Edge, but still depends on the profile's encryption state |
| Arc | Not supported | Arc cookie import is not implemented on Windows in this fork |
| Comet | Not supported | Comet cookie import is not implemented on Windows in this fork |

## Persistent Login-Session Runtime Support

`browse login-session ...` is the recommended Windows auth path.

| Runtime browser | Status | Notes |
|---|---|---|
| Chrome | Preferred | First choice on Windows when installed |
| Edge | Supported | Used as a fallback if Chrome is missing |
| Playwright Chromium | Supported fallback | Used when Chrome and Edge are not available |
| Brave | Not a login-session target | Cookie import source only, not the preferred persistent runtime |
| Arc / Comet | Not a login-session target | Current Windows flow does not launch these browsers for persistent sessions |

## Site Workflow Compatibility

| Situation | Status | Best path |
|---|---|---|
| Regular logged-in website | Works well | `browse login-session headed` once, then `headless` |
| Douyin | Works with caveats | Start headed, log in manually, then try headless reuse |
| GitHub / internal dashboards | Works well | Persistent login-session is usually the cleanest path |
| CAPTCHA at login | Manual step required | Solve manually in headed mode |
| WebAuthn / security-key login | Manual step required | Complete auth manually, then reuse the resulting session |
| SMS / device confirmation | Manual step required | Finish it in the headed browser window |
| Anti-bot bypassing | Not supported | This repo preserves a legitimate session; it does not defeat protections |

## What Definitely Will Not Work Automatically

- Decrypting every modern Chrome or Edge default profile on Windows
- Importing Arc cookies on Windows in the current implementation
- Importing Comet cookies on Windows in the current implementation
- Automatically solving CAPTCHA, WebAuthn prompts, or phone-verification challenges
- Bypassing site anti-bot systems

## Recommended Decision Rule

Use this simple rule:

1. If direct cookie import works, great, use it
2. If Windows reports a decryption limitation, switch immediately to `browse login-session headed`
3. If a site stays fragile in headless mode, keep that site on headed persistent mode
