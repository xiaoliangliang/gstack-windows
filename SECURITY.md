# Security Policy

## Supported Versions

Security-sensitive fixes are applied to the latest published branch in this repository.

## What Counts as Security-Relevant Here

For `gstack-windows`, security-relevant issues usually involve:

- browser-session leakage
- accidental token/cookie exposure
- unsafe file-path handling
- unsafe local process behavior
- misleading auth/session behavior that could cause users to test in the wrong account

## Reporting a Vulnerability

Please do not open a public GitHub issue for a sensitive report.

Instead, use one of these paths:

1. Open a private GitHub security advisory for this repository if available.
2. If that is not available, contact the maintainer directly before publishing details.

When reporting, include:

- affected file or command
- Windows version
- browser and browser version
- whether the issue happens in Codex, Git Bash, or PowerShell
- minimal repro steps
- impact and what data could be exposed

## Disclosure Expectations

- Give maintainers a reasonable window to verify and patch
- Avoid posting live tokens, cookies, or bearer values
- Prefer sanitized logs and redacted screenshots
