export interface FallbackConfig {
  MAX_TOTAL_ATTEMPTS: number;
  PER_ATTEMPT_TIMEOUT_MS: number;
  OVERALL_DEADLINE_MS: number;
  ALLOW_PAID_MODELS: boolean;
}

export const DEFAULT_FALLBACK_CONFIG: FallbackConfig = {
  // Default to at most THREE TOTAL attempts, including the original attempt
  MAX_TOTAL_ATTEMPTS: 3,
  // Per-attempt timeout: 12 seconds
  PER_ATTEMPT_TIMEOUT_MS: 12000,
  // Overall request deadline: 25 seconds
  OVERALL_DEADLINE_MS: 25000,
  // Never silently switch to paid models without an authorized budget policy
  ALLOW_PAID_MODELS: false,
};

export function getFallbackConfig(overrides?: Partial<FallbackConfig>): FallbackConfig {
  return {
    MAX_TOTAL_ATTEMPTS: overrides?.MAX_TOTAL_ATTEMPTS ?? (
      process.env.HELLO_MAX_ATTEMPTS ? Math.max(1, parseInt(process.env.HELLO_MAX_ATTEMPTS, 10)) : DEFAULT_FALLBACK_CONFIG.MAX_TOTAL_ATTEMPTS
    ),
    PER_ATTEMPT_TIMEOUT_MS: overrides?.PER_ATTEMPT_TIMEOUT_MS ?? (
      process.env.HELLO_PER_ATTEMPT_TIMEOUT_MS ? parseInt(process.env.HELLO_PER_ATTEMPT_TIMEOUT_MS, 10) : DEFAULT_FALLBACK_CONFIG.PER_ATTEMPT_TIMEOUT_MS
    ),
    OVERALL_DEADLINE_MS: overrides?.OVERALL_DEADLINE_MS ?? (
      process.env.HELLO_OVERALL_DEADLINE_MS ? parseInt(process.env.HELLO_OVERALL_DEADLINE_MS, 10) : DEFAULT_FALLBACK_CONFIG.OVERALL_DEADLINE_MS
    ),
    ALLOW_PAID_MODELS: overrides?.ALLOW_PAID_MODELS ?? (
      process.env.HELLO_ALLOW_PAID_MODELS === 'true' ? true : DEFAULT_FALLBACK_CONFIG.ALLOW_PAID_MODELS
    ),
  };
}
