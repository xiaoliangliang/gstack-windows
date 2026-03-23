# Command Recipes

These are the fastest practical workflows for `gstack-windows` on Windows + Codex.

## 1. Create a reusable Douyin login session

From the project you want Codex to work inside:

```powershell
browse login-session headed https://www.douyin.com/
```

Then:

1. Sign in manually in the opened browser window
2. Confirm the homepage loads correctly
3. Switch to headless reuse:

```powershell
browse login-session headless
```

Verify:

```powershell
browse goto https://www.douyin.com/
browse snapshot -i
browse screenshot
```

## 2. Check whether your saved login state is still healthy

```powershell
browse login-session status
browse goto https://www.douyin.com/
browse cookies
browse storage
```

If the site suddenly behaves as logged out, reopen the saved profile in headed mode:

```powershell
browse login-session headed https://www.douyin.com/
```

## 3. Capture evidence from a logged-in page

Use this when you want something you can attach to an issue or share with a teammate:

```powershell
browse console --clear
browse network --clear
browse goto https://target-site.com/
browse snapshot -i -a -o ".gstack\\annotated.png"
browse screenshot ".gstack\\page.png"
browse console
browse network
```

## 4. Dogfood a private dashboard behind login

```powershell
browse login-session headed https://internal.example.com/
```

After manual sign-in:

```powershell
browse login-session headless
browse goto https://internal.example.com/
browse snapshot -i
browse click @e3
browse snapshot -D
```

This is usually the best flow for admin panels, staging apps, feature-flag dashboards, and private QA environments.

## 5. Check responsive layouts while logged in

```powershell
browse goto https://target-site.com/
browse responsive ".gstack\\auth-layout"
```

That saves:

- `.gstack\auth-layout-mobile.png`
- `.gstack\auth-layout-tablet.png`
- `.gstack\auth-layout-desktop.png`

## 6. Diagnose why an authenticated flow is failing

```powershell
browse login-session status
browse goto https://target-site.com/
browse console
browse network
browse dialog
```

If the page redirects back to login, the usual causes are:

- the site invalidated the session
- CAPTCHA or anti-bot checks appeared
- the site binds auth more tightly to headed browsing

In that case, retry with:

```powershell
browse login-session headed https://target-site.com/
```

## 7. Use direct browser cookie import when it is actually supported

```powershell
browse cookie-import-browser
```

Or target a known domain:

```powershell
browse cookie-import-browser chrome --domain douyin.com
```

If Windows reports a decryption limitation, stop fighting it and switch to the persistent session flow instead.

## 8. Cleanly return to normal ephemeral browsing

```powershell
browse login-session stop
browse status
```

This disables persistent-profile mode but keeps the saved profile on disk, so you can reopen it later with:

```powershell
browse login-session headed
```
