import { contextBridge, ipcRenderer } from 'electron'

const api = {
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
  executeSearchIntent: (query: string, chatName?: string): Promise<{
    type: 'ranked_contacts' | 'messages' | 'aggregation' | 'timeline'
    explanation: string
    ranked?: { contact: string; value: number; label: string }[]
    messages?: { body: string; chat_name: string; sent_at: string; is_from_me: number; snippet: string }[]
    aggregation?: { contact: string; count: number; samples: { body: string; sent_at: string; is_from_me: number }[] }[]
    timeline?: { period: string; value: number }[]
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
  getClosenessScores: (chatIdentifier?: string): Promise<{
    chat_identifier: string; total_score: number; tier: string
    volume_score: number; balance_score: number; recency_score: number
    consistency_score: number; reaction_score: number; sentiment_score: number
    shared_group_score: number; updated_at: string
  }[]> => ipcRenderer.invoke('get-closeness-scores', chatIdentifier),
  getClosenessRank: (chatIdentifier: string): Promise<number | null> => ipcRenderer.invoke('get-closeness-rank', chatIdentifier),
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
