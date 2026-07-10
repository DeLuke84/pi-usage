# Depend on undocumented OpenAI Codex usage endpoints

Codex Usage needs OpenAI subscription quota data, but pi-usage does not have a documented public API for that account-level quota. We will fetch Codex Usage from the undocumented read-only `https://chatgpt.com/backend-api/wham/usage` endpoint using pi's existing `openai-codex` auth state, parse defensively, and hide the Active Usage Display on failure rather than blocking the feature until public APIs exist.
