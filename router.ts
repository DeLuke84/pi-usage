import type { ModelContext } from "./types";
import { Provider, type ProviderType } from "./types";
import { selectUsageProvider } from "./usage";

export function getProvider(ctx: ModelContext): ProviderType {
  const provider = selectUsageProvider(ctx);
  if (provider === "glm") return Provider.ZAI;
  if (provider === "codex") return Provider.CODEX;
  return null;
}
