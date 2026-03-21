import { contextBridge, ipcRenderer } from 'electron'

const api = {
  authGetConfig: (): Promise<{ enabled: boolean; touchIdAvailable: boolean; touchIdEnabled: boolean; idleTimeoutMinutes: number; hasPassword: boolean }> => ipcRenderer.invoke('auth-get-config'),
  authSetEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('auth-set-enabled', enabled),
  authSetupPassword: (password: string): Promise<void> => ipcRenderer.invoke('auth-setup-password', password),
  authVerifyPassword: (password: string): Promise<boolean> => ipcRenderer.invoke('auth-verify-password', password),
  authTouchId: (): Promise<'success' | 'fallback' | 'failed'> => ipcRenderer.invoke('auth-touch-id'),
  authUpdateActivity: (): Promise<void> => ipcRenderer.invoke('auth-update-activity'),
  authShouldLock: (): Promise<boolean> => ipcRenderer.invoke('auth-should-lock'),
  authSetIdleTimeout: (minutes: number): Promise<void> => ipcRenderer.invoke('auth-set-idle-timeout', minutes),
  authSetTouchIdEnabled: (enabled: boolean): Promise<void> => ipcRenderer.invoke('auth-set-touch-id-enabled', enabled),
  getAiEnabled: (): Promise<boolean> => ipcRenderer.invoke('get-ai-enabled'),
  setAiEnabled: (val: boolean): Promise<void> => ipcRenderer.invoke('set-ai-enabled', val),
  getFeatureFlags: (): Promise<{ aiEnabled: boolean; tier: 'local' | 'pro' }> => ipcRenderer.invoke('get-feature-flags'),
  checkDiskAccess: (): Promise<boolean> => ipcRenderer.invoke('check-disk-access'),
  searchAttachments: (
    query: string, filters: Record<string, string>, page?: number, limit?: number, sortOrder?: string
  ): Promise<unknown[]> => ipcRenderer.invoke('search-attachments', query, filters, page ?? 0, limit ?? 50, sortOrder),
  getAttachments: (
    filters: Record<string, string>, page?: number, limit?: number, sortOrder?: string
  ): Promise<unknown[]> => ipcRenderer.invoke('get-attachments', filters, page ?? 0, limit ?? 50, sortOrder),
  getStats: (chatNameFilter?: string, dateFrom?: string, dateTo?: string): Promise<{
    total: number; images: number; videos: number; documents: number; audio: number; unavailable: number
    chatNames: { rawName: string; attachmentCount: number; lastMessageDate: string; messageCount: number; sentCount: number; receivedCount: number; initiationCount: number; laughsGenerated: number; laughsReceived: number; isGroup: boolean; lateNightRatio: number; avgReplyMinutes: number }[]
    chatNameMap: Record<string, string>
    globalPeakHour: number | null; globalPeakWeekday: number | null
  }> => ipcRenderer.invoke('get-stats', chatNameFilter, dateFrom, dateTo),
  searchMessages: (query: string, chatName?: string, limit?: number): Promise<{
    id: number; body: string; chat_name: string; sender_handle: string | null; is_from_me: number; sent_at: string; snippet: string
  }[]> => ipcRenderer.invoke('search-messages', query, chatName, limit),
  getMessageIndexStatus: (): Promise<{ total: number; indexed: number }> => ipcRenderer.invoke('get-message-index-status'),
  getVocabStats: (chatName?: string): Promise<{
    uniqueWords: number; totalWords: number; avgWordsPerMessage: number; theirAvgWordsPerMessage: number; topWords: { word: string; count: number }[]
  }> => ipcRenderer.invoke('get-vocab-stats', chatName),
  getWordOrigins: (chatName?: string): Promise<{
    word: string; firstUsed: string; chatName: string; totalUses: number; firstMessage: string | null
  }[]> => ipcRenderer.invoke('get-word-origins', chatName),
  saveShareCard: (dataUrl: string, filename: string): Promise<boolean> => ipcRenderer.invoke('save-share-card', dataUrl, filename),
  getUsageStats: (dateFrom?: string, dateTo?: string): Promise<{
    totalMessages: number; sentMessages: number; receivedMessages: number
    messagesPerYear: { year: number; count: number }[]
    busiestDay: { date: string; count: number } | null
    busiestYear: { year: number; count: number } | null
    activeConversations: number
  }> => ipcRenderer.invoke('get-usage-stats', dateFrom, dateTo),
  getMessagingNetwork: (): Promise<{
    nodes: { rawName: string; messageCount: number }[]
    edges: { a: string; b: string; sharedGroups: number }[]
    groups: { chatId: string; displayName: string; members: string[]; messageCount: number }[]
  }> => ipcRenderer.invoke('get-messaging-network'),
  getTodayInHistory: (): Promise<{
    id: number; filename: string; original_path: string; thumbnail_path: string | null;
    created_at: string; chat_name: string | null; is_image: number; is_available: number
  }[]> => ipcRenderer.invoke('get-today-in-history'),
  getFastStats: (chatNameFilter?: string, dateFrom?: string, dateTo?: string): Promise<{
    total: number; images: number; videos: number; documents: number; audio: number; unavailable: number
    chatNames: { rawName: string; attachmentCount: number; lastMessageDate: string; messageCount: number; sentCount: number; receivedCount: number; initiationCount: number; laughsGenerated: number; laughsReceived: number; isGroup: boolean; lateNightRatio: number; avgReplyMinutes: number }[]
    chatNameMap: Record<string, string>
    globalPeakHour: number | null; globalPeakWeekday: number | null
  }> => ipcRenderer.invoke('get-fast-stats', chatNameFilter, dateFrom, dateTo),
  getAttachment: (id: number): Promise<unknown> => ipcRenderer.invoke('get-attachment', id),
  openInFinder: (path: string): Promise<boolean> => ipcRenderer.invoke('open-in-finder', path),
  openFile: (path: string): Promise<boolean> => ipcRenderer.invoke('open-file', path),
  getMessageContext: (chatName: string, sentAt: string): Promise<{ messages: { body: string; is_from_me: number; sent_at: string }[] }> => ipcRenderer.invoke('get-message-context', chatName, sentAt),
  exportFile: (id: number): Promise<boolean> => ipcRenderer.invoke('export-file', id),
  getIndexingProgress: (): Promise<{ total: number; processed: number; currentFile: string; phase?: string }> =>
    ipcRenderer.invoke('get-indexing-progress'),
  startIndexing: (priorityChats?: string[]): Promise<void> => ipcRenderer.invoke('start-indexing', priorityChats),
  getChatSummaries: (): Promise<{
    chat_id: number; chat_name: string; display_name: string; raw_chat_identifier: string
    attachment_count: number; last_message_date: string; participant_handles: string[]
  }[]> => ipcRenderer.invoke('get-chat-summaries'),
  saveChatPriorities: (chats: string[]): Promise<void> => ipcRenderer.invoke('save-chat-priorities', chats),
  getSavedPriorityChats: (): Promise<string[] | null> => ipcRenderer.invoke('get-saved-priority-chats'),
  resetIndexing: (): Promise<void> => ipcRenderer.invoke('reset-indexing'),
  confirmReset: (): Promise<boolean> => ipcRenderer.invoke('confirm-reset'),
  recoverFromIcloud: (id: number): Promise<boolean> => ipcRenderer.invoke('recover-from-icloud', id),
  openImessage: (handle: string): Promise<void> => ipcRenderer.invoke('open-imessage', handle),
  getFileUrl: (path: string): Promise<string | null> => ipcRenderer.invoke('get-file-url', path),
  onIndexingProgress: (
    callback: (data: { total: number; processed: number; currentFile: string; phase?: string }) => void
  ): (() => void) => {
    const handler = (_event: unknown, data: { total: number; processed: number; currentFile: string; phase?: string }): void => callback(data)
    ipcRenderer.on('indexing-progress', handler)
    return () => ipcRenderer.removeListener('indexing-progress', handler)
  },
  onNewAttachment: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('new-attachment-indexed', handler)
    return () => ipcRenderer.removeListener('new-attachment-indexed', handler)
  },
  onFocusSearch: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('focus-search', handler)
    return () => ipcRenderer.removeListener('focus-search', handler)
  },
  onToggleSidebar: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('toggle-sidebar', handler)
    return () => ipcRenderer.removeListener('toggle-sidebar', handler)
  },
  onSetViewGrid: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('set-view-grid', handler)
    return () => ipcRenderer.removeListener('set-view-grid', handler)
  },
  onSetViewList: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('set-view-list', handler)
    return () => ipcRenderer.removeListener('set-view-list', handler)
  },
  onManageConversations: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('menu-manage-conversations', handler)
    return () => ipcRenderer.removeListener('menu-manage-conversations', handler)
  },
  resolveChatNames: (): Promise<void> => ipcRenderer.invoke('resolve-chat-names'),
  hideChat: (chatIdentifier: string): Promise<void> => ipcRenderer.invoke('hide-chat', chatIdentifier),
  searchConversationsAi: (description: string, conversations: { display: string; identifier: string }[]): Promise<{ error: string | null; results: string[] | null }> =>
    ipcRenderer.invoke('search-conversations-ai', description, conversations),
  setAnthropicKey: (key: string): Promise<void> => ipcRenderer.invoke('set-anthropic-key', key),
  getAIStatus: (): Promise<{ configured: boolean; provider: 'anthropic' | 'none' }> => ipcRenderer.invoke('get-ai-status'),
  enrichTopicEras: (eras: { startYear: number; endYear: number; heuristicLabel: string; keywords: string[]; strengthScore: number }[]): Promise<{
    originalLabel: string; enrichedLabel: string | null; summary: string | null; suppress: boolean
  }[] | null> => ipcRenderer.invoke('enrich-topic-eras', eras),
  getTopicEraContext: (chapters: { startYear: number; endYear: number; topicLabel: string; keywords: string[] }[]): Promise<{
    contexts: {
      startYear: number; endYear: number; heuristicLabel: string; keywords: string[]
      topPeople: { name: string; count: number }[]; topGroups: { name: string; count: number }[]
      sampleMessages: { text: string; hasLink: boolean; hasMedia: boolean }[]
      topAttachments: { type: string; count: number }[]; repeatedPhrases: string[]; summaryHint: string
    }[]
  }> => ipcRenderer.invoke('get-topic-era-context', chapters),
  enrichTopicErasV2: (contexts: unknown[]): Promise<{
    originalLabel: string; enrichedLabel: string | null; summary: string | null; suppress: boolean
  }[] | null> => ipcRenderer.invoke('enrich-topic-eras-v2', contexts),
  enrichMemoryMoments: (moments: { type: string; title: string; subtitle: string; dateLabel: string; contactName: string | null; metric: number | null }[]): Promise<{
    originalTitle: string; enrichedTitle: string | null; enrichedSubtitle: string | null
  }[] | null> => ipcRenderer.invoke('enrich-memory-moments', moments),
  getConversationStats: (chatIdentifier: string, isGroup: boolean): Promise<unknown> => ipcRenderer.invoke('get-conversation-stats', chatIdentifier, isGroup),
  getRelationshipTimeline: (chatIdentifier: string): Promise<{
    events: { timestamp: string; type: string; description: string; metric?: number }[]
  }> => ipcRenderer.invoke('get-relationship-timeline', chatIdentifier),
  getSocialGravity: (): Promise<{
    individualYears: { year: number; dominant: { name: string; count: number; pct: number }; top5: { name: string; count: number; pct: number }[]; clusterContacts: string[]; clusterLabel: string | null }[]
    groupYears: { year: number; dominant: { name: string; count: number; pct: number }; top5: { name: string; count: number; pct: number }[]; clusterContacts: string[]; clusterLabel: string | null }[]
  }> => ipcRenderer.invoke('get-social-gravity'),
  getTopicEras: (): Promise<{
    chapters: { startYear: number; endYear: number; topicLabel: string; keywords: string[]; strengthScore: number }[]
  }> => ipcRenderer.invoke('get-topic-eras'),
  getMemoryMoments: (): Promise<{
    moments: { type: string; title: string; subtitle: string; dateLabel: string; chatName: string | null; metric: number | null }[]
  }> => ipcRenderer.invoke('get-memory-moments'),
  interpretSearchQuery: (query: string): Promise<{
    type: string; phrase: string | null; groupBy: string | null; sort: string; explanation: string
  } | null> => ipcRenderer.invoke('interpret-search-query', query),
  searchMessagesAggregated: (phrase: string, chatName?: string): Promise<{
    contact: string; count: number; samples: { body: string; sent_at: string; is_from_me: number }[]
  }[]> => ipcRenderer.invoke('search-messages-aggregated', phrase, chatName),
  executeSearchV2: (query: string, chatName?: string): Promise<{
    plan: {
      people: string[]; groups: string[]; peopleIdentifiers: string[]
      topic: string | null; keywords: string[]; semanticExpansions: string[]
      timeRange: { start: string | null; end: string | null; description: string } | null
      modalities: string; attachmentTypes: string[]; speaker: string
      sort: string; answerMode: string; confidence: number; originalQuery: string
    }
    sections: {
      messages: { body: string; chat_name: string; contact_name: string; is_from_me: boolean; sent_at: string; matchReason: string; relevanceScore: number }[]
      attachments: { id: number; filename: string; chat_name: string; contact_name: string; created_at: string; thumbnail_path: string | null; original_path: string | null; is_image: boolean; matchReason: string; ocrSnippet?: string }[]
      conversations: { chat_name: string; contact_name: string; messageCount: number; matchingMessages: number; dateRange: string; preview: string }[]
      summary: string | null
    }
    totalResults: number; searchTimeMs: number
  }> => ipcRenderer.invoke('execute-search-v2', query, chatName),
  executeSearchIntent: (query: string, chatName?: string): Promise<{
    type: 'ranked_contacts' | 'messages' | 'aggregation' | 'timeline' | 'conversational'
    explanation: string
    ranked?: { contact: string; value: number; label: string }[]
    messages?: { body: string; chat_name: string; sent_at: string; is_from_me: number; snippet: string }[]
    aggregation?: { contact: string; count: number; samples: { body: string; sent_at: string; is_from_me: number }[] }[]
    timeline?: { period: string; value: number }[]
    answer?: string; sources?: string[]; followUp?: string | null
  }> => ipcRenderer.invoke('execute-search-intent', query, chatName),
  refreshReactions: (): Promise<void> => ipcRenderer.invoke('refresh-reactions'),
  getHiddenChats: (): Promise<string[]> => ipcRenderer.invoke('get-hidden-chats'),
  generateWrapped: (year: number): Promise<unknown> => ipcRenderer.invoke('generate-wrapped', year),
  getWrappedYears: (): Promise<number[]> => ipcRenderer.invoke('get-wrapped-years'),
  onChatNamesResolved: (callback: (data: unknown[]) => void): (() => void) => {
    const handler = (_event: unknown, data: unknown[]): void => callback(data)
    ipcRenderer.on('chat-names-resolved', handler)
    return () => ipcRenderer.removeListener('chat-names-resolved', handler)
  },
  getConversationSignals: (chatIdentifier?: string): Promise<{
    chat_identifier: string; total_analyzed: number; laugh_count: number
    question_count: number; link_count: number; emoji_rate: number
    avg_word_count: number; avg_heat: number; positive_rate: number
    negative_rate: number; all_caps_rate: number; updated_at: string
  }[]> => ipcRenderer.invoke('get-conversation-signals', chatIdentifier),
  getAnalysisProgress: (): Promise<{
    totalMessages: number; analyzedMessages: number; lastRunAt: string | null; isRunning: boolean
  }> => ipcRenderer.invoke('get-analysis-progress'),
  getBehavioralPatterns: (): Promise<{
    rareWords: { word: string; count: number; conversations: number }[]; vocabularySize: number; avgWordLength: number
    repeatedMessages: { body: string; recipients: number; count: number }[]
    laughsGiven: number; laughsReceived: number; humorRatio: number; funniestHour: number
    busiestHour: number; busiestDay: number; avgMessagesPerActiveDay: number; longestSilence: number; marathonCount: number
    photoRatio: number; linkShareRate: number; avgAttachmentsPerDay: number; mostSharedDomain: string | null
  }> => ipcRenderer.invoke('get-behavioral-patterns'),
  detectNicknames: (chatIdentifier: string, contactName: string): Promise<{ nicknames: { name: string; count: number; isFromMe: boolean }[] }> => ipcRenderer.invoke('detect-nicknames', chatIdentifier, contactName),
  getMediaIntelligence: (chatIdentifier?: string): Promise<{
    topSenders: { chatName: string; count: number }[]; topReceivers: { chatName: string; count: number }[]
    myMediaCount: number; theirMediaCount: number; totalMedia: number
    imageCount: number; videoCount: number; documentCount: number
    mediaByMonth: { month: string; count: number }[]
    peakMediaMonth: { month: string; count: number } | null
    mediaHeavy: { chatName: string; mediaCount: number; messageCount: number; ratio: number }[]
  }> => ipcRenderer.invoke('get-media-intelligence', chatIdentifier),
  getMonthlyAverages: (chatIdentifier?: string): Promise<{
    months: { month: string; count: number; isAnomaly: boolean; anomalyType: 'spike' | 'drop' | null; deviation: number }[]
    avgPerMonth: number; anomalies: { month: string; count: number; type: 'spike' | 'drop'; message: string }[]
  }> => ipcRenderer.invoke('get-monthly-averages', chatIdentifier),
  analyzeRelationshipDynamics: (chatIdentifier: string, contactName: string, stats: Record<string, unknown>): Promise<{
    conflictPattern: string | null; supportPattern: string | null; insideJokes: string[] | null; relationshipPhase: string | null; communicationStyleMatch: number | null; topicEvolution: { then: string; now: string } | null; vulnerabilityBalance: string | null
  } | null> => ipcRenderer.invoke('analyze-relationship-dynamics', chatIdentifier, contactName, stats),
  getRelationshipDynamics: (chatIdentifier: string): Promise<{
    myTotalWords: number; theirTotalWords: number; effortRatio: number
    myQuestions: number; theirQuestions: number
    myPositiveRate: number; theirPositiveRate: number; myNegativeRate: number; theirNegativeRate: number
    myAvgReplyMinutes: number; theirAvgReplyMinutes: number
    monthlyVolume: { month: string; count: number }[]; trajectoryDirection: string
    myInitiations: number; totalDays: number
    marathonDays: number; silentGaps: number; avgDailyWhenActive: number
    lateNightMessages: number; totalLateNightAcrossAll: number; lateNightExclusivity: number
    myMediaCount: number; theirMediaCount: number
    heatByHour: { hour: number; avgHeat: number }[]; peakHeatHour: number
  }> => ipcRenderer.invoke('get-relationship-dynamics', chatIdentifier),
  getSignificantPhotos: (chatIdentifier: string): Promise<{ id: number; filename: string; thumbnail_path: string; created_at: string; original_path: string }[]> => ipcRenderer.invoke('get-significant-photos', chatIdentifier),
  getMessageSamples: (chatIdentifier: string): Promise<{
    recent: { body: string; is_from_me: number; sent_at: string }[]
    old: { body: string; is_from_me: number; sent_at: string }[]
  }> => ipcRenderer.invoke('get-message-samples', chatIdentifier),
  getAttachmentContext: (attachmentId: number): Promise<{ body: string; is_from_me: number; sent_at: string }[]> => ipcRenderer.invoke('get-attachment-context', attachmentId),
  summarizeConversation: (chatIdentifier: string, contactName: string): Promise<{ summary: string; topics: string[]; tone: string } | null> => ipcRenderer.invoke('summarize-conversation', chatIdentifier, contactName),
  generateRelationshipNarrative: (chatIdentifier: string, contactName: string, stats: Record<string, unknown>): Promise<{ narrative: string; headline: string } | null> => ipcRenderer.invoke('generate-relationship-narrative', chatIdentifier, contactName, stats),
  generateAttachmentCaption: (chatIdentifier: string, contactName: string, attachmentInfo: Record<string, unknown>, surroundingMessages: Record<string, unknown>[]): Promise<{ caption: string } | null> => ipcRenderer.invoke('generate-attachment-caption', chatIdentifier, contactName, attachmentInfo, surroundingMessages),
  getSignals: (chatIdentifier?: string): Promise<{ chat_identifier: string; signal_type: string; period: string; current_value: number; baseline_value: number; delta_pct: number; is_significant: boolean; direction: string }[]> => ipcRenderer.invoke('get-signals', chatIdentifier),
  getActiveAlerts: (): Promise<{ chat_identifier: string; signal_type: string; message: string; severity: string; delta_pct: number }[]> => ipcRenderer.invoke('get-active-alerts'),
  getClosenessScores: (chatIdentifier?: string): Promise<{
    chat_identifier: string; total_score: number; tier: string
    volume_score: number; balance_score: number; recency_score: number
    consistency_score: number; reaction_score: number; sentiment_score: number
    shared_group_score: number; updated_at: string
  }[]> => ipcRenderer.invoke('get-closeness-scores', chatIdentifier),
  getClosenessRank: (chatIdentifier: string): Promise<number | null> => ipcRenderer.invoke('get-closeness-rank', chatIdentifier),
  getProactiveItems: (): Promise<{ items: { id: number; chat_identifier: string; item_type: string; description: string; source_message: string; due_date: string | null; status: string; priority: number; contact_name: string }[] }> => ipcRenderer.invoke('get-proactive-items'),
  dismissProactiveItem: (id: number): Promise<void> => ipcRenderer.invoke('dismiss-proactive-item', id),
  completeProactiveItem: (id: number): Promise<void> => ipcRenderer.invoke('complete-proactive-item', id),
  onAnalysisProgress: (callback: (data: { analyzed: number; total: number }) => void): (() => void) => {
    const handler = (_event: unknown, data: { analyzed: number; total: number }): void => callback(data)
    ipcRenderer.on('analysis-progress', handler)
    return () => ipcRenderer.removeListener('analysis-progress', handler)
  }
}

export type StashAPI = typeof api

if (process.contextIsolated) {
  try { contextBridge.exposeInMainWorld('api', api) }
  catch (error) { console.error(error) }
} else {
  // @ts-ignore
  window.api = api
}
