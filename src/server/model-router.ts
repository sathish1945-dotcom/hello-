import type { TaskCategory, RouteResolution } from '../types/index.ts';
import { MODEL_REGISTRY, isFreeModel, refreshAvailableModels } from './model-registry.ts';
import { getFallbackConfig, type FallbackConfig } from './fallback-config.ts';

export interface RouteCapabilities {
  tools?: boolean;
  images?: boolean;
}

export interface RouteResolutionOptions {
  capabilities?: RouteCapabilities;
  configOverrides?: Partial<FallbackConfig>;
  timeoutMs?: number;
}

export async function resolveModelRoute(
  category: TaskCategory,
  userApiKey?: string,
  requestedModelId?: string,
  options?: Partial<FallbackConfig> | RouteResolutionOptions
): Promise<RouteResolution> {
  const config = MODEL_REGISTRY[category] || MODEL_REGISTRY.general;
  const configOverrides = (options && 'configOverrides' in options)
    ? options.configOverrides
    : (options as Partial<FallbackConfig> | undefined);
  const capabilities = (options && 'capabilities' in options) ? options.capabilities : undefined;

  const fallbackCfg = getFallbackConfig(configOverrides);
  const availableModels = await refreshAvailableModels(userApiKey);

  // Preference list based on category and capability preservation
  const preferences: string[] = [];
  if (requestedModelId) {
    preferences.push(requestedModelId);
  }

  // Add category-specific primary and secondary models
  preferences.push(config.primaryModel, config.secondaryModel);

  // Cross-category fallback must NEVER drop required capabilities:
  // - If tools or coding are required, only allow coding/tool-capable models
  // - Otherwise, general fallbacks are acceptable
  if (category === 'coding' || capabilities?.tools) {
    preferences.push('qwen/qwen3.8-27b:free', 'google/gemma-4-26b-a4b-it:free');
  } else if (category === 'reasoning') {
    preferences.push(MODEL_REGISTRY.general.primaryModel, 'qwen/qwen3.8-27b:free');
  } else if (category === 'finance') {
    preferences.push(MODEL_REGISTRY.general.primaryModel, 'qwen/qwen3.8-27b:free');
  } else {
    preferences.push(
      MODEL_REGISTRY.general.primaryModel,
      MODEL_REGISTRY.general.secondaryModel,
      'qwen/qwen3.8-27b:free',
      'google/gemma-4-26b-a4b-it:free',
      ...availableModels
    );
  }

  // Filter candidates against safety and paid policies:
  // 1. Never route chat to openrouter/free (random utility/moderation router)
  // 2. A boolean flag alone is NOT an authorized monetary budget policy.
  //    Paid models remain strictly disabled unless ALLOW_PAID_MODELS is explicitly enabled
  //    under a verified spending policy.
  const candidates = [...new Set(preferences)].filter((model): model is string => {
    if (!model) return false;
    if (model === 'openrouter/free' || model === 'openrouter/auto:free') return false;
    if (!fallbackCfg.ALLOW_PAID_MODELS && !isFreeModel(model)) return false;
    return true;
  });

  // Verify availability against OpenRouter model registry
  // In the event of network/registry lookup failure (availableModels is empty),
  // fallback to static configured candidates.
  const verified = availableModels.size > 0
    ? candidates.filter((model) => availableModels.has(model))
    : candidates;

  const candidatePool = verified.length > 0 ? verified : candidates;
  const cappedModels = configOverrides?.MAX_TOTAL_ATTEMPTS
    ? candidatePool.slice(0, configOverrides.MAX_TOTAL_ATTEMPTS)
    : candidatePool;

  const selectedModel = cappedModels[0] || (availableModels.size === 0 ? config.primaryModel : '');
  const fallbackModels = cappedModels.length > 1
    ? cappedModels.filter((m) => m !== selectedModel)
    : [];

  return {
    category,
    selectedModel,
    fallbackModels,
    displayName: config.displayName,
  };
}
