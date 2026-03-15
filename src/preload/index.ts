import { contextBridge, ipcRenderer } from 'electron'

const api = {
  checkDiskAccess: (): Promise<boolean> => ipcRenderer.invoke('check-disk-access'),
  searchAttachments: (
    query: string,
    filters: Record<string, string>,
    page?: number,
    limit?: number
  ): Promise<unknown[]> => ipcRenderer.invoke('search-attachments', query, filters, page ?? 0, limit ?? 50),
  getAttachments: (
    filters: Record<string, string>,
    page?: number,
    limit?: number
  ): Promise<unknown[]> => ipcRenderer.invoke('get-attachments', filters, page ?? 0, limit ?? 50),
  getStats: (): Promise<{
    total: number
    images: number
    videos: number
    documents: number
    audio: number
    unavailable: number
    chatNames: string[]
  }> => ipcRenderer.invoke('get-stats'),
  getAttachment: (id: number): Promise<unknown> => ipcRenderer.invoke('get-attachment', id),
  openInFinder: (path: string): Promise<boolean> => ipcRenderer.invoke('open-in-finder', path),
  exportFile: (id: number): Promise<boolean> => ipcRenderer.invoke('export-file', id),
  getIndexingProgress: (): Promise<{ total: number; processed: number; currentFile: string; phase?: string }> =>
    ipcRenderer.invoke('get-indexing-progress'),
  startIndexing: (priorityChats?: string[]): Promise<void> => ipcRenderer.invoke('start-indexing', priorityChats),
  getChatSummaries: (): Promise<{
    chat_name: string
    display_name: string
    raw_chat_identifier: string
    attachment_count: number
    last_message_date: string
    participant_handles: string[]
  }[]> => ipcRenderer.invoke('get-chat-summaries'),
  saveChatPriorities: (chats: string[]): Promise<void> => ipcRenderer.invoke('save-chat-priorities', chats),
  getSavedPriorityChats: (): Promise<string[] | null> => ipcRenderer.invoke('get-saved-priority-chats'),
  resetIndexing: (): Promise<void> => ipcRenderer.invoke('reset-indexing'),
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
  }
}

export type StashAPI = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.api = api
}
