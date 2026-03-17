import { app, shell, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, powerSaveBlocker } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { checkFullDiskAccess } from './messagesReader'
import { initDb, searchAttachments, getStats, getFastStats, getTodayInHistory, getUsageStats, getMessagingNetwork, getAttachmentById, closeDb, hideChat, getHiddenChats, getConversationStats, updateReactionCounts, invalidateLaughCache, searchMessages, getMessageIndexStatus, getVocabStats } from './db'
import { startIndexing, getIndexingProgress, fetchChatSummaries, saveChatPriorities, getSavedPriorityChats, resetIndexing, recoverAttachment, resolveNamesInBackground } from './indexer'
import { compileContactsHelper, resolveContact, resolveContactsBatch } from './contacts'
import { generateWrapped, getAvailableYears } from './wrapped'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { extname } from 'path'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

function sendToRenderer(channel: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel)
  }
}

function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Manage Conversations',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: (): void => sendToRenderer('menu-manage-conversations')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Focus Search',
          accelerator: 'CmdOrCtrl+F',
          click: (): void => sendToRenderer('focus-search')
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: (): void => sendToRenderer('toggle-sidebar')
        },
        { type: 'separator' },
        {
          label: 'Grid View',
          accelerator: 'CmdOrCtrl+1',
          click: (): void => sendToRenderer('set-view-grid')
        },
        {
          label: 'List View',
          accelerator: 'CmdOrCtrl+2',
          click: (): void => sendToRenderer('set-view-list')
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0a0a0a',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function setupIpc(): void {
  ipcMain.handle('check-disk-access', () => checkFullDiskAccess())

  ipcMain.handle('search-attachments', (_event, query: string, filters: Record<string, string>, page: number, limit: number, sortOrder?: string) => {
    return searchAttachments(query, filters, page, limit, sortOrder)
  })

  ipcMain.handle('get-attachments', (_event, filters: Record<string, string>, page: number, limit: number, sortOrder?: string) => {
    return searchAttachments('', filters, page, limit, sortOrder)
  })

  ipcMain.handle('get-stats', (_event, chatNameFilter?: string, dateFrom?: string, dateTo?: string) => {
    const stats = getStats(chatNameFilter, dateFrom, dateTo)
    const chatNameMap: Record<string, string> = {}
    try {
      compileContactsHelper()
      const handles = stats.chatNames.map((c) => c.rawName).filter((n) => n && (n.startsWith('+') || n.includes('@')))
      if (handles.length > 0) resolveContactsBatch(handles)

      for (const chat of stats.chatNames) {
        const name = chat.rawName
        if (!name) continue
        if (name.startsWith('+') || name.includes('@')) {
          // Phone/email — try contact resolution
          const resolved = resolveContact(name)
          chatNameMap[name] = (resolved && resolved !== name) ? resolved : name
        } else if (/^chat\d+/i.test(name) || name.includes(';')) {
          // Group chat identifier
          chatNameMap[name] = chat.isGroup ? `Group · ${name.length > 20 ? 'chat' : name}` : 'Group chat'
        } else {
          // Named group chat or other — use as-is
          chatNameMap[name] = name.startsWith('#') ? 'Group chat' : name
        }
      }
    } catch {
      for (const c of stats.chatNames) chatNameMap[c.rawName] = c.rawName
    }
    return { ...stats, chatNameMap }
  })
  ipcMain.handle('get-today-in-history', () => getTodayInHistory())
  ipcMain.handle('get-usage-stats', (_event, dateFrom?: string, dateTo?: string) => getUsageStats(dateFrom, dateTo))
  ipcMain.handle('search-messages', (_event, query: string, chatName?: string, limit?: number) => searchMessages(query, chatName, limit))
  ipcMain.handle('get-message-index-status', () => getMessageIndexStatus())
  ipcMain.handle('get-vocab-stats', (_event, chatName?: string) => getVocabStats(chatName))
  ipcMain.handle('get-messaging-network', () => getMessagingNetwork())
  ipcMain.handle('get-fast-stats', (_event, chatNameFilter?: string, dateFrom?: string, dateTo?: string) => {
    return { ...getFastStats(chatNameFilter, dateFrom, dateTo), chatNameMap: {} }
  })
  ipcMain.handle('get-attachment', (_event, id: number) => getAttachmentById(id))

  ipcMain.handle('open-in-finder', (_event, filePath: string) => {
    if (existsSync(filePath)) { shell.showItemInFolder(filePath); return true }
    return false
  })

  ipcMain.handle('export-file', async (_event, id: number) => {
    const att = getAttachmentById(id)
    if (!att || !existsSync(att.original_path)) return false
    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: att.filename,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (!result.canceled && result.filePath) { copyFileSync(att.original_path, result.filePath); return true }
    return false
  })

  ipcMain.handle('get-indexing-progress', () => getIndexingProgress())
  ipcMain.handle('start-indexing', async (_event, priorityChats?: string[]) => {
    const blockerId = powerSaveBlocker.start('prevent-app-suspension')
    try {
      await startIndexing(mainWindow, priorityChats)
    } finally {
      powerSaveBlocker.stop(blockerId)
    }
  })
  ipcMain.handle('get-chat-summaries', () => fetchChatSummaries())
  ipcMain.handle('resolve-chat-names', () => { resolveNamesInBackground(mainWindow) })
  ipcMain.handle('save-chat-priorities', (_event, chats: string[]) => { saveChatPriorities(chats) })
  ipcMain.handle('get-saved-priority-chats', () => getSavedPriorityChats())
  ipcMain.handle('reset-indexing', () => { resetIndexing() })
  ipcMain.handle('recover-from-icloud', async (_event, id: number) => recoverAttachment(id))
  ipcMain.handle('get-conversation-stats', (_event, chatIdentifier: string, isGroup: boolean) => getConversationStats(chatIdentifier, isGroup))

  ipcMain.handle('set-anthropic-key', (_event, key: string) => {
    const keyPath = join(app.getPath('userData'), 'anthropic-key.txt')
    const { writeFileSync } = require('fs')
    writeFileSync(keyPath, key.trim())
    console.log('[AI Search] API key saved to', keyPath)
  })

  ipcMain.handle('search-conversations-ai', async (_event, description: string, conversations: { display: string; identifier: string }[]) => {
    let apiKey = process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) {
      const keyPath = join(app.getPath('userData'), 'anthropic-key.txt')
      if (existsSync(keyPath)) {
        apiKey = readFileSync(keyPath, 'utf-8').trim()
      }
    }
    if (!apiKey) {
      console.warn('[AI Search] No API key found')
      return { error: 'NO_KEY', results: null }
    }
    try {
      const https = require('https')
      const chatList = conversations.map((c) => `- "${c.display}" (identifier: ${c.identifier})`).join('\n')
      const postData = JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        system: 'You are helping a user find a specific iMessage conversation. You will be given a list of conversations and the user\'s description. Return ONLY a JSON array of identifier strings for the conversations that best match the description, ranked by confidence, max 5 results. No explanation, just the JSON array.',
        messages: [{ role: 'user', content: `Conversations:\n${chatList}\n\nFind: ${description}` }]
      })

      const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = https.request({
          hostname: 'api.anthropic.com',
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Length': Buffer.byteLength(postData)
          }
        }, (res: any) => {
          let body = ''
          res.on('data', (chunk: string) => { body += chunk })
          res.on('end', () => resolve({ status: res.statusCode, body }))
        })
        req.on('error', reject)
        req.write(postData)
        req.end()
      })

      if (response.status !== 200) {
        console.error('[AI Search] API error:', response.status, response.body)
        return { error: `API error: ${response.status}`, results: null }
      }
      const data = JSON.parse(response.body)
      const text = data.content?.[0]?.text || '[]'
      const matches = JSON.parse(text) as string[]
      console.log('[AI Search] Found', matches.length, 'matches')
      return { error: null, results: matches }
    } catch (err) {
      console.error('[AI Search] Error:', err)
      return { error: String(err), results: null }
    }
  })
  ipcMain.handle('refresh-reactions', () => { updateReactionCounts() })
  ipcMain.handle('hide-chat', (_event, chatIdentifier: string) => { hideChat(chatIdentifier) })
  ipcMain.handle('get-hidden-chats', () => getHiddenChats())
  ipcMain.handle('generate-wrapped', (_event, year: number) => generateWrapped(year))
  ipcMain.handle('get-wrapped-years', () => getAvailableYears())
  ipcMain.handle('open-imessage', (_event, handle: string) => { shell.openExternal(`imessage://${handle}`) })

  ipcMain.handle('confirm-reset', async () => {
    if (!mainWindow) return false
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      message: 'Reset your index?',
      detail: 'This will delete all indexed data and start over.',
      buttons: ['Cancel', 'Reset'],
      defaultId: 0,
      cancelId: 0
    })
    return result.response === 1
  })

  ipcMain.handle('get-file-url', (_event, filePath: string) => {
    if (!filePath || !existsSync(filePath)) return null
    try {
      const ext = extname(filePath).toLowerCase()
      // HEIC/HEIF: convert on-the-fly with sips, cache the result
      if (ext === '.heic' || ext === '.heif') {
        const { execSync } = require('child_process')
        const { mkdirSync } = require('fs')
        const cacheDir = join(app.getPath('appData'), 'Stash', 'thumbnails')
        mkdirSync(cacheDir, { recursive: true })
        const hash = filePath.replace(/[^a-zA-Z0-9]/g, '_').slice(-60)
        const cachedPath = join(cacheDir, `heic_${hash}.jpg`)
        if (!existsSync(cachedPath)) {
          try {
            execSync(`sips -s format jpeg -Z 800 "${filePath}" --out "${cachedPath}"`, { timeout: 15000, stdio: 'ignore' })
          } catch { return null }
        }
        if (existsSync(cachedPath)) {
          const data = readFileSync(cachedPath)
          return `data:image/jpeg;base64,${data.toString('base64')}`
        }
        return null
      }
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
        '.tiff': 'image/tiff'
      }
      const mime = mimeMap[ext] || 'image/jpeg'
      const data = readFileSync(filePath)
      return `data:${mime};base64,${data.toString('base64')}`
    } catch {
      return null
    }
  })
}

function createTray(): void {
  // 16x16 teal square placeholder icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVQ4T2P8z8BQz0BAwMDAwMDIQCRgYGBgYPz//389kQYMHwMo/iJRNgyYASS7AABt+A4RMfMnIgAAAABJRU5ErkJggg=='
  )
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Stash')

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Open Stash', click: () => { mainWindow?.show(); mainWindow?.focus() } },
    { type: 'separator' },
    { label: 'Quit Stash', click: () => { isQuitting = true; app.quit() } }
  ])
  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow?.isVisible()) { mainWindow.hide() }
    else { mainWindow?.show(); mainWindow?.focus() }
  })
}

function setupLoginItem(): void {
  const prefsPath = join(app.getPath('userData'), 'prefs.json')
  let prefs: Record<string, unknown> = {}
  if (existsSync(prefsPath)) {
    try { prefs = JSON.parse(readFileSync(prefsPath, 'utf-8')) } catch { /* ignore */ }
  }
  if (!prefs.loginItemSet) {
    app.setLoginItemSettings({ openAtLogin: true })
    prefs.loginItemSet = true
    const { writeFileSync } = require('fs')
    writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
  }
}

app.whenReady().then(() => {
  app.setName('Stash')
  initDb()
  // Force all stat caches to refresh on startup
  invalidateLaughCache()
  createMenu()
  createTray()
  setupLoginItem()

  // Compile contacts binary early
  compileContactsHelper()

  setupIpc()
  createWindow()

  // Deferred reaction count sync
  setTimeout(() => { try { updateReactionCounts() } catch (e) { console.error('[Reactions]', e) } }, 3000)

  // Hide to tray instead of quitting on window close
  mainWindow!.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow!.hide()
    }
  })

  app.on('activate', () => {
    if (mainWindow) mainWindow.show()
    else createWindow()
  })
})

app.on('window-all-closed', () => {
  // Don't quit on macOS — stays in tray
})

app.on('before-quit', () => { isQuitting = true; closeDb() })
