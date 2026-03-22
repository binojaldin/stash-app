import { getAiEnabled } from './prefs'

export type Tier = 'local' | 'pro'

export interface FeatureFlags {
  aiEnabled: boolean
  tier: Tier
}

export const PRO_FEATURES = [
  'ai_search',
  'ai_summaries',
  'ai_topic_eras',
  'ai_memory_moments',
  'ai_relationship_narrative',
  'ai_proactive_intel',
  'wrapped_ai_insights',
  'conversation_view',
] as const

export type ProFeature = typeof PRO_FEATURES[number]

const PRO_FEATURE_SET = new Set<string>(PRO_FEATURES)

export function getFeatureFlags(): FeatureFlags {
  return {
    aiEnabled: getAiEnabled(),
    tier: getTier()
  }
}

export function getTier(): Tier {
  // Future: check license/subscription status
  return 'local'
}

export function isProFeature(feature: string): boolean {
  return PRO_FEATURE_SET.has(feature)
}
