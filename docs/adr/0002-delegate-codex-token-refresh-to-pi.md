# Delegate Codex token refresh to pi

Codex Usage uses pi's existing `openai-codex` OAuth login, and the status refresh may run before normal model requests refresh an expired token. We will delegate expired Codex token refresh to pi's auth path when available rather than implementing extension-owned OAuth writes, accepting internal coupling to keep credentials consistent and avoid calling undocumented usage endpoints with expired tokens.
