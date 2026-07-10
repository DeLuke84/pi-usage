# Powerline Usage Display

Date: 2026-05-24
Status: Approved — revised background-bar format

## Problem

The current usage display is rendered as a below-editor widget with a text-heavy status line such as `Codex Pro 5x | 5h: 28% ↻ 0h 29m | week: 4% ↻ Sun | spark ...`. The desired display should live in Pi's powerline/status area instead of taking editor space, and should communicate usage more graphically with icons, bars, and compact symbols.

## Goals

- Render usage via `ctx.ui.setStatus(...)` instead of the Pi widget API.
- Replace text-heavy quota descriptions with a compact graphical status format.
- Keep enough numeric information to remain understandable at a glance.
- Use the best-looking Unicode or Nerd Font glyphs for the job.
- Avoid the bot/robot symbol because it is already used for the current prompt mode.

## Non-goals

- Do not redesign usage fetching, authentication, provider selection, or refresh timing.
- Do not change underlying quota parsing or percentage calculations.
- Do not add configuration options for multiple visual styles in this pass.

## Chosen approach

Use a readable compact status format with short labels and percentage text, while representing the bar through background fill rather than visible bar glyphs. The background bar should represent used quota.

The icon-only compact format was too cryptic, and lower-block bar glyphs were not reliably visible in the powerline/status area. The corrected format should use readable labels and let colored background spans carry the graphical bar.

Example direction, exact styling subject to implementation fit:

```text
5h 2% ↻ 4h48 · 1w 5% ↻ Su · s5h 8% ↻ 1h35 · s1w 2% ↻ Su
```

Rules:
- Remove provider/plan display completely.
- Use short readable labels: `5h`, `1w`, `s5h`, `s1w`.
- Put spaces around the refresh icon: ` ↻ `.
- Separate usage segments with the minimal non-whitespace separator `·`.
- Use background color/fill as the bar for used quota instead of visible bar glyph characters.
- Colorize usage segments by remaining quota severity.

## Alternatives considered

- Hybrid bars + small numbers: selected because it is graphical while preserving precision.
- Mostly graphical with no percentages: rejected because it would be harder to understand.
- Ultra-compact badge-only status: rejected because it would be too cryptic for regular use.

## Requirements

- Clear the old widget display and stop registering `setWidget` for active usage.
- Use `setStatus` with the `pi-usage` status key for the new display.
- Continue clearing the legacy `glm-usage` status key for compatibility.
- Keep dimmed/stale display behavior while refreshing if feasible in the status text.
- Do not include provider/plan identity in the usage status.
- Render each usage limit as a compact readable segment with:
  - a short label (`5h`, `1w`, `s5h`, `s1w`),
  - the percentage value with `%`,
  - the refresh icon with spaces around it,
  - compact reset information that remains visible,
  - background fill/color representing used quota.
- Do not show provider/plan identity in the usage status.
- Do not use visible bar glyph characters for the bar; the bar should be represented by background styling/fill.
- Keep existing error behavior, but route unavailable usage through status instead of widget.

## Acceptance criteria

- Usage appears in the powerline/status area, not as a below-editor widget.
- No active usage widget remains after startup, model selection, refresh, or errors.
- The new status is graphical and substantially shorter than the current pipe-separated display.
- The new status does not contain provider/plan identity or verbose labels such as `Codex Pro 5×`, `spark 5h`, `spark week`, `5h:`, or `week:`.
- The refresh icon has spaces around it in each segment.
- The robot/bot glyph is not used for the usage status.
- Existing tests are updated or extended for the new status format.
- The project test suite passes.

## Implementation notes

- Primary files likely involved:
  - `index.ts` — replace `showWidget` with status-based rendering.
  - `format.ts` — add or change formatting to produce the graphical powerline string.
  - `format.test.ts` / `index.test.ts` — update assertions.
- Pi docs confirm `ctx.ui.setStatus(key, text)` is the persistent footer/status indicator API.
- Existing `OLD_STATUS_ID = "glm-usage"` should continue to be cleared.

## Open questions

- None.
