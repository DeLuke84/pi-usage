export const Provider = {
  ZAI: "zai" as const,
  CODEX: "codex" as const,
} as const;

export type ProviderType = (typeof Provider)[keyof typeof Provider] | null;

export const Unit = {
  FIVE_HOUR: 3,
  WEEKLY: 6,
  MONTHLY: 5,
} as const;

export type UnitType = (typeof Unit)[keyof typeof Unit];

export interface QuotaLimit {
  type: string;
  unit: number;
  percentage: number;
  nextResetTime: number;
}

export interface QuotaResponse {
  code: number;
  data: {
    limits: QuotaLimit[];
    level: string;
  };
}

export interface ParsedQuota {
  fiveHour: QuotaLimit | null;
  weekly: QuotaLimit | null;
  planLevel: string;
}

export interface ModelContext {
  provider?: string | null;
  model?: string;
}
