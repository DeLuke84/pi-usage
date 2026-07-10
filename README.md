# pi-usage

A [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that displays your active model provider's subscription quota usage in the status bar. Supports z.ai (GLM Coding Plan) and OpenAI Codex subscriptions.

## What it does

Shows subscription quota usage in pi's footer status bar for your active model provider:

- **z.ai (GLM)** — 5-hour and weekly quotas with dynamic reset times
- **OpenAI Codex** — Quota windows derived from the API (for example 5-hour/weekly subscriptions or a 30-day Free-plan window)
- **GitHub Copilot** — Premium-interaction quota with its 30-day reset window

Displays as a percentage used (e.g., `5h: 16% | week: 4%`).

The status bar updates live every **60 seconds** during long agent runs.

The status bar also shows:

- Plan level (when available)
- Time until quota reset (relative or absolute as appropriate)

Example outputs:

```
5h 16% ↻ 2h14 · 1w 4% ↻ Mo
30d 17% ↻ Aug 9
```

## How it works

### Data sources

- **z.ai (GLM)**: `https://api.z.ai/api/monitor/usage/quota/limit` with API key from `~/.pi/agent/auth.json` → `zai.key`
- **OpenAI Codex**: `https://chatgpt.com/backend-api/wham/usage` using `~/.pi/agent/auth.json` → `openai-codex` OAuth state. `limit_window_seconds` determines whether a window is rendered as hours, a week, or days.
- **GitHub Copilot**: `copilot_internal/user` (with a chat-header fallback) using the `github-copilot` OAuth state; premium interactions are rendered as a 30-day window.

**Example response:**

```json
{
  "code": 200,
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "percentage": 16,
        "nextResetTime": 1777819631597
      },
      {
        "type": "TOKENS_LIMIT",
        "unit": 6,
        "percentage": 4,
        "nextResetTime": 1778262784969
      },
      {
        "type": "TIME_LIMIT",
        "unit": 5,
        "percentage": 0,
        "nextResetTime": 1780336384978
      }
    ],
    "level": "lite"
  }
}
```

**Unit mapping (discovered from z.ai frontend source):**

| `unit` | Meaning |
|--------|---------|
| 3 | 5 Hours Quota (TOKENS_LIMIT) |
| 6 | Weekly Quota (TOKENS_LIMIT) |
| 5 | Monthly Web Search/Reader/Zread (TIME_LIMIT) — parsed but not displayed in v1 |

### Refresh behavior

- Fetches quota data immediately on pi startup (`session_start` event)
- Starts 60-second periodic refresh when agent begins (`agent_start` event)
- Stops periodic refresh and fetches quota after each agent turn (`agent_end` event)
- Live updates every 60 seconds during long agent runs
- Updates the status bar immediately with provider-specific formatting
- Falls back gracefully on errors (shows last known state or hides)
- All fetches are fire-and-forget (non-blocking) with a 5-second timeout

### Display

Uses `ctx.ui.setStatus("pi-usage", ...)` to render a provider-neutral status bar entry:

```
5h 16% ↻ 2h14 · 1w 4% ↻ Mo
30d 17% ↻ Aug 9
```

- `↻` shows when the quota resets (relative or absolute as appropriate)
- Plan level shown on the left (when available)
- Missing quota types are omitted from the display
- Status entry is hidden for unsupported providers

## Configuration

No configuration needed. The extension reads provider credentials from `~/.pi/agent/auth.json`:

```json
{
  "zai": {
    "type": "api_key",
    "key": "your-zai-api-key-here"
  },
  "openai-codex": {
    "type": "oauth",
    "access": "access-token",
    "refresh": "refresh-token",
    "expires": 1777819631597,
    "accountId": "account-id"
  }
}
```

Required fields:
- `zai.key` for z.ai (GLM) usage
- `openai-codex.access`, `refresh`, `expires`, and `accountId` for Codex usage

The extension will hide the status bar entry if required credentials are missing for the active provider.

**Environment variable (for testing):**

Set `PI_AUTH_DIR` to override the auth file path:

```bash
export PI_AUTH_DIR=/path/to/test/auth/dir
```

This is useful for testing without affecting your actual pi configuration.

## Installation

### Quick install (recommended)

```bash
pi install npm:@unfixed3854/pi-usage
```

This automatically downloads and installs the extension. Restart pi to load it.

### Manual install

1. Create the extensions directory if it doesn't exist:
   ```bash
   mkdir -p ~/.pi/agent/extensions/pi-usage
   ```

2. Copy the extension files to the directory:
   ```bash
   cp -r pi-usage/* ~/.pi/agent/extensions/pi-usage/
   ```

3. Restart pi to load the extension

The extension will automatically load and display your quota usage in the status bar.

## Troubleshooting

### Status bar not showing

**Cause:** Auth file is missing or required credentials are not configured for the active provider.

**Fix:** Ensure `~/.pi/agent/auth.json` exists and contains valid credentials for your provider:

```bash
cat ~/.pi/agent/auth.json
```

For z.ai (GLM):
```json
{
  "zai": {
    "type": "api_key",
    "key": "sk-..."
  }
}
```

For OpenAI Codex:
```json
{
  "openai-codex": {
    "type": "oauth",
    "access": "access-token",
    "refresh": "refresh-token",
    "expires": 1777819631597,
    "accountId": "account-id"
  }
}
```

If the file is missing, configure your provider credentials in pi settings.

### Status bar shows old data

**Cause:** API fetch failed or timed out, falling back to cached data.

**Fix:** Check the pi console for error messages. Common issues:

- Network connectivity problems
- API endpoint is temporarily unavailable
- Invalid API key or expired OAuth credentials

To force a refresh, trigger a new agent turn (ask a question in pi).

### "Request timeout: fetch took longer than 5 seconds" in logs

**Cause:** The API request timed out after 5 seconds.

**Fix:** This is usually temporary. The extension will retry on the next agent turn. If the issue persists:

- Check your network connection
- Verify the active provider endpoint is accessible
- Check if z.ai or ChatGPT services are operational

### Extension not loading

**Cause:** The extension files are not in the correct location or have syntax errors.

**Fix:** Verify the extension is installed correctly:

```bash
ls -la ~/.pi/agent/extensions/pi-usage/
```

You should see:

```
index.ts
api.ts
auth.ts
format.ts
types.ts
package.json
tsconfig.json
```

Check the pi console for any error messages during startup.

### TypeScript compilation errors

**Cause:** The extension was not built or has type errors.

**Fix:** Run the typecheck to identify issues:

```bash
bun run typecheck
```

Fix any reported errors and rebuild the extension if necessary.

## Future ideas (out of scope for v1)

- **Color coding** — green/yellow/red as quota fills up (needs `ctx.ui.setStatus` color support or ANSI codes)
- **`/pi-usage` command** — detailed breakdown with `pi.registerCommand()`
- **Token consumption per model** — requires additional API data
- **Web search quota** (unit 5) — z.ai returns it but it is not displayed
- **Configurable refresh interval** — make the 60-second interval adjustable
- **Detailed error display** — show minimal error message instead of hiding status bar

## Architecture

The extension is structured with clear separation of concerns:

- `timer.ts` — Periodic refresh controller with dependency injection (fully unit testable)
- `api.ts` — z.ai API client with timeout and error handling
- `codex.ts` — OpenAI Codex usage fetcher and parser
- `auth.ts` — provider credential reader from `~/.pi/agent/auth.json`
- `format.ts` — Status bar formatting utilities
- `usage.ts` / `router.ts` — provider-neutral routing and usage snapshots
- `types.ts` — Shared TypeScript types
- `index.ts` — Extension entry point, wires everything together

All modules follow TDD with co-located tests (`<module>.test.ts`).
