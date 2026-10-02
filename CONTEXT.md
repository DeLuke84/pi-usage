# pi-usage

pi-usage displays subscription quota state for the model provider currently active in pi, so provider-neutral docs and status text reflect the account whose model is being used.

## Language

**Provider**:
An account-backed model service whose quota can be displayed in the status bar.
_Avoid_: vendor, backend

**Codex Model**:
Any selected pi model whose provider is `openai-codex`.
_Avoid_: generic OpenAI API models, model-name substring matching, manual model list

**GLM Model**:
Any selected pi model whose provider is `zai`.
_Avoid_: `z.ai` spelling, gateway-routed GLM names, model-name substring matching, manual model list

**Subscription Usage**:
Provider-reported consumed quota for a paid interactive coding plan.
_Avoid_: API usage, spend, token accounting, remaining-quota percentage

**Codex Usage**:
OpenAI subscription quota consumption for OpenAI-hosted Codex models, fetched from read-only undocumented OpenAI account endpoints using pi's existing `openai-codex` account login with pi-owned token refresh when available.
_Avoid_: OpenAI API usage, local Codex CLI stats, separate extension credentials, public API-only constraint, quota-consuming probes, failure-only inference, extension-owned OAuth writes

**Token Plan Usage**:
Xiaomi MiMo Token Plan quota consumption for Token Plan models, fetched from the platform console endpoints using the browser's platform session cookie and the console's `userId` request parameter.
_Avoid_: API key auth, local token counting, quota-consuming probes, invented quota windows, model-name matching

**Token Plan Model**:
Any selected pi model whose provider is `xiaomi-token-plan-ams`.
_Avoid_: MiMo model-name matching, regional provider suffix guessing

**GLM Usage**:
z.ai subscription quota consumption for GLM Coding Plan models.
_Avoid_: z.ai API usage, generic GLM stats

**Active Usage Display**:
The single provider-neutral status bar entry showing usage for the currently selected model's provider on the next agent run, using a common compact quota shape across providers without inventing missing provider limits or showing another provider's cache.
_Avoid_: GLM-specific status naming, multiple provider badges, inactive quota display, immediate selector interception, raw provider fields, fake quota periods, cross-provider stale data

## Relationships

- A **Provider** exposes exactly one **Subscription Usage** view in the status bar.
- A **Codex Model** selects **Codex Usage** for the **Active Usage Display**.
- A **GLM Model** selects **GLM Usage** for the **Active Usage Display**.
- A **Token Plan Model** selects **Token Plan Usage** for the **Active Usage Display**.
- **Codex Usage**, **GLM Usage**, and **Token Plan Usage** are provider-specific forms of **Subscription Usage**.
- **Codex Usage** uses pi's stored `openai-codex` auth state.
- **Codex Usage** may depend on undocumented OpenAI account endpoints.
- Undocumented endpoint discovery is validated with pi auth and minimal GET/HEAD-only live probes before implementation.
- Token refresh for **Codex Usage** is delegated to pi when the stored `openai-codex` token is expired.
- The **Active Usage Display** shows exactly one provider at a time.
- The **Active Usage Display** is named provider-neutrally as `pi-usage`.
- User-facing docs describe active provider usage, not GLM-only usage.
- **Codex Usage** mirrors the **GLM Usage** display shape when equivalent limits exist.
- **Codex Usage** shows only provider-exposed limits when they do not match **GLM Usage** periods.
- When multiple OpenAI endpoints exist, **Codex Usage** prefers subscription/account limit semantics over per-request token history.
- **Token Plan Usage** reads the live `platform.xiaomimimo.com` session cookie from the browser's Chromium cookie store at every refresh, because the platform rotates session cookies frequently. `PI_USAGE_TOKEN_PLAN_COOKIE` and `xiaomi-token-plan-ams.cookie` in pi's auth file are manual fallbacks; a stored cookie stays in sync with the live browser cookie while it exists.
- A rejected session cookie is healed by opening the platform console once, which re-issues the cookie set. The rejection message names the remedy and the cookie source that was used.
- **Token Plan Usage** shows the plan quota window (`plan_total_token`) and compensation credits while they carry a limit. The monthly window (`monthUsage`) mirrors the plan quota and is never shown.
- **Token Plan Usage** resets at the provider-reported `currentPeriodEnd`.
- **Codex Usage** shows `Codex` without a plan label when OpenAI does not expose the plan name.
- **Subscription Usage** percentages mean used quota, not remaining quota.
- Relative reset durations are normalized to absolute reset timestamps before display.
- The **Active Usage Display** is hidden when the selected model's provider has no known **Subscription Usage** source.
- Cached **Subscription Usage** is valid only for the same selected **Provider**.
- A selected model change affects the **Active Usage Display** on the next agent run.
- Long-running agent runs refresh **Subscription Usage** for the active **Provider** every 60 seconds.

## Example dialogue

> **Dev:** "If pi is using a Codex model, should the status bar show API spend?"
> **Domain expert:** "No — **Codex Usage** means OpenAI subscription quota consumption, not OpenAI API usage."

## Flagged ambiguities

- "codex usage" could mean OpenAI subscription quota, OpenAI API usage, or local Codex CLI stats — resolved: **Codex Usage** means OpenAI subscription quota consumption for OpenAI-hosted Codex models.
- "automatically switch" could mean one replacement entry or multiple visible entries — resolved: **Active Usage Display** is one status bar entry replaced according to the selected model's provider.
- "Codex model" could mean model IDs containing `codex`, generic `openai`, or subscription `openai-codex` — resolved: **Codex Model** means any selected pi model with provider `openai-codex`.
- "GLM model" could mean model IDs containing `glm`, gateway-routed GLM, `z.ai`, or `zai` — resolved: **GLM Model** means selected pi model with provider `zai`.
- "Codex auth" could mean separate credentials or pi's stored login — resolved: reuse pi's `openai-codex` auth state.
- "token handling" could mean hiding expired auth, calling expired tokens, extension-owned refresh, or pi-owned refresh — resolved: delegate expired `openai-codex` auth refresh to pi when possible.
- "Codex display" could mean raw provider data, compact percent, or GLM-compatible quota text — resolved: mirror the **GLM Usage** shape when possible.
- "GLM-shaped Codex display" could imply forced 5h/week fields — resolved: show only available OpenAI limits rather than inventing periods.
- "error fallback" could show any last cache or same-provider cache only — resolved: hide when the current provider has no successful same-provider usage fetch.
- "periodic refresh" could remain GLM-only or apply to all providers — resolved: refresh the active **Provider** during long runs.
- "status ID" could remain `glm-usage` or become provider-neutral — resolved: rename the active status entry to `pi-usage`.
- "docs naming" could remain GLM-specific or become provider-neutral — resolved: document pi-usage as active provider usage.
- "OpenAI usage API" could require public-only APIs or undocumented account endpoints — resolved: allow undocumented OpenAI endpoints for **Codex Usage**.
- "endpoint discovery" could be abstract-first, probe-first, browser-source-first, or prior-art-first — resolved: inspect existing public solutions first, then validate candidates with authenticated GET/HEAD-only live probes.
- "Codex quota source" could include read-only endpoints, failure payloads, or quota-consuming probes — resolved: only read-only GET/HEAD endpoints are acceptable.
- "Codex usage endpoint" could mean subscription limits or token history — resolved: prefer subscription/account limit endpoints.
- "Codex plan label" could be guessed, fetched separately, or omitted — resolved: omit plan label unless the usage source exposes it.
- "percentage" could mean remaining or used quota — resolved: percentages mean used quota to match **GLM Usage**.
- "reset time" could remain provider text or become normalized time — resolved: normalize relative reset durations to absolute reset timestamps.
- "unsupported provider" could mean stale usage, explicit unsupported text, or no display — resolved: hide the **Active Usage Display**.
- "automatically switch" could mean immediate model-selector updates or next-run updates — resolved: switch on the next agent run using pi lifecycle hooks.
