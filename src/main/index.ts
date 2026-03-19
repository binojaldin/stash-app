import { app, shell, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, powerSaveBlocker } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { checkFullDiskAccess } from './messagesReader'
import { initDb, searchAttachments, getStats, getFastStats, getTodayInHistory, getUsageStats, getMessagingNetwork, getAttachmentById, closeDb, hideChat, getHiddenChats, getConversationStats, getRelationshipTimeline, getSocialGravity, getTopicEras, getTopicEraContext, getMemoryMoments, searchMessagesAggregated, updateReactionCounts, invalidateLaughCache, searchMessages, getMessageIndexStatus, getVocabStats, getWordOrigins, detectSignalQuery, executeSearchIntent, getMessageSamples, getAttachmentContext, getSignificantPhotos, getRelationshipDynamics } from './db'
import { startIndexing, getIndexingProgress, fetchChatSummaries, saveChatPriorities, getSavedPriorityChats, resetIndexing, recoverAttachment, resolveNamesInBackground } from './indexer'
import { compileContactsHelper, resolveContact, resolveContactsBatch } from './contacts'
import { generateWrapped, getAvailableYears } from './wrapped'
import { runMessageAnalysis, getConversationSignals, getAnalysisProgress } from './messageAnalysis'
import { computeClosenessScores, getClosenessScores, getClosenessRank } from './closenessRank'
import { setApiKey, getAIStatus, searchConversationsAI, enrichTopicEras, enrichTopicErasV2, enrichMemoryMoments, interpretSearchQuery, summarizeConversation, generateRelationshipNarrative, generateAttachmentCaption } from './ai'
import type { TopicEraSummaryInput, TopicEraContextInput, MemoryMomentSummaryInput } from './ai'
import { getCachedAnalytics, setCachedAnalytics, getMessageCountSignal, yieldEventLoop, invalidateSignalCache } from './analyticsCache'
import { Worker } from 'worker_threads'
import { copyFileSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { extname } from 'path'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false

// DB readiness gate — IPC handlers that need the DB await this
let dbReady: Promise<void>
let dbReadyResolve: () => void
dbReady = new Promise(r => { dbReadyResolve = r })

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

// ── Worker-based getStats for cold launches ──
let statsWorkerPromise: Promise<unknown> | null = null

function getStatsWorkerPath(): string {
  const dir = join(app.getPath('userData'), 'workers')
  mkdirSync(dir, { recursive: true })
  const workerPath = join(dir, 'statsWorker.js')
  // Resolve better-sqlite3 absolute path from the main process context
  const sqlitePath = require.resolve('better-sqlite3').replace(/\\/g, '/')
  // Write worker script (idempotent, tiny file)
  writeFileSync(workerPath, `
const { parentPort, workerData } = require('worker_threads');
const Database = require('${sqlitePath}');
const { homedir } = require('os');
const { join } = require('path');
const { existsSync } = require('fs');

const { stashDbPath, chatNameFilter, dateFrom, dateTo } = workerData;

try {
  const d = new Database(stashDbPath);
  d.pragma('journal_mode = WAL');

  // ── Basic counts from stash.db ──
  const dateParts = [];
  if (dateFrom) dateParts.push("created_at >= '" + dateFrom + "'");
  if (dateTo) dateParts.push("created_at <= '" + dateTo + " 23:59:59'");
  const dateWhere = dateParts.length ? ' AND ' + dateParts.join(' AND ') : '';
  const chatCond = chatNameFilter ? ' AND chat_name = ?' : '';
  const params = chatNameFilter ? [chatNameFilter] : [];

  const total = d.prepare('SELECT COUNT(*) as c FROM attachments WHERE 1=1' + chatCond + dateWhere).get(...params).c;
  const images = d.prepare('SELECT COUNT(*) as c FROM attachments WHERE is_image = 1' + chatCond + dateWhere).get(...params).c;
  const videos = d.prepare('SELECT COUNT(*) as c FROM attachments WHERE is_video = 1' + chatCond + dateWhere).get(...params).c;
  const documents = d.prepare('SELECT COUNT(*) as c FROM attachments WHERE is_document = 1' + chatCond + dateWhere).get(...params).c;
  const audio = d.prepare("SELECT COUNT(*) as c FROM attachments WHERE mime_type LIKE 'audio/%' " + chatCond + dateWhere).get(...params).c;
  const unavailable = d.prepare('SELECT COUNT(*) as c FROM attachments WHERE is_available = 0' + chatCond + dateWhere).get(...params).c;

  // Hidden chats
  let hiddenSet = new Set();
  try { const hRows = d.prepare("SELECT chat_identifier FROM hidden_chats").all(); hiddenSet = new Set(hRows.map(r => r.chat_identifier)); } catch {}

  let chatSql = 'SELECT chat_name, COUNT(*) as attachment_count, MAX(created_at) as last_message_date FROM attachments WHERE chat_name IS NOT NULL';
  const chatParams = [];
  if (dateFrom) { chatSql += ' AND created_at >= ?'; chatParams.push(dateFrom); }
  if (dateTo) { chatSql += ' AND created_at <= ?'; chatParams.push(dateTo); }
  chatSql += ' GROUP BY chat_name ORDER BY last_message_date DESC';
  const chatDetails = d.prepare(chatSql).all(...chatParams).filter(r => !hiddenSet.has(r.chat_name));

  // ── Enrich from chat.db ──
  const chatDbPath = join(homedir(), 'Library/Messages/chat.db');
  let msgStats = new Map();
  let globalPeakHour = null, globalPeakWeekday = null;
  let participantMap = new Map();
  let displayToIdentifier = new Map();

  if (existsSync(chatDbPath)) {
    const chatDb = new Database(chatDbPath, { readonly: true });
    const APPLE_EPOCH = 978307200;
    const NS = 1000000000;
    const appleFrom = dateFrom ? (new Date(dateFrom).getTime() / 1000 - APPLE_EPOCH) * NS : null;
    const appleTo = dateTo ? (new Date(dateTo).getTime() / 1000 - APPLE_EPOCH) * NS : null;
    const dateCond = (appleFrom ? ' AND m.date >= ' + appleFrom : '') + (appleTo ? ' AND m.date <= ' + appleTo : '');

    // Message counts
    const rows = chatDb.prepare(
      'SELECT c.chat_identifier as chat_name, COUNT(m.ROWID) as message_count, ' +
      'SUM(CASE WHEN m.is_from_me = 1 THEN 1 ELSE 0 END) as sent_count, ' +
      'SUM(CASE WHEN m.is_from_me = 0 THEN 1 ELSE 0 END) as received_count ' +
      'FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id ' +
      'JOIN chat c ON cmj.chat_id = c.ROWID ' +
      'WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1)' + dateCond + ' GROUP BY c.chat_identifier'
    ).all();

    // Initiation counts
    const initRows = chatDb.prepare(
      'SELECT c.chat_identifier as chat_name, COUNT(DISTINCT date(datetime(m.date/1000000000 + 978307200, \\'unixepoch\\', \\'localtime\\'))) as init_days ' +
      'FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id ' +
      'JOIN chat c ON cmj.chat_id = c.ROWID WHERE m.is_from_me = 1' + dateCond + ' GROUP BY c.chat_identifier'
    ).all();
    const initMap = new Map(initRows.map(r => [r.chat_name, r.init_days]));

    // Display name map
    try {
      const dnRows = chatDb.prepare("SELECT NULLIF(display_name, '') as dn, chat_identifier as ci FROM chat WHERE display_name IS NOT NULL AND display_name != ''").all();
      for (const r of dnRows) if (r.dn) displayToIdentifier.set(r.dn, r.ci);
    } catch {}

    // Participant counts
    try {
      const partRows = chatDb.prepare(
        'SELECT c.ROWID as chat_id, c.chat_identifier as chat_name, COUNT(DISTINCT chj.handle_id) as participant_count ' +
        'FROM chat c LEFT JOIN chat_handle_join chj ON c.ROWID = chj.chat_id GROUP BY c.ROWID, c.chat_identifier'
      ).all();
      for (const row of partRows) participantMap.set(row.chat_name, row.participant_count > 1 ? 2 : 1);
    } catch {}

    // Laugh detection — Method 1: Text-based (no time window, no sequential check)
    const LAUGH_RE = /\\b(lol|lmao|lmfao|rofl|hehe|omg dead|im dead|i'm dead|i cant|i can't|dying|i'm dying|im dying)\\b|ha{2,}|he{2,}/i;
    const LAUGH_EMOJI = /[\\u{1F602}\\u{1F923}\\u{1F480}\\u{2620}]/u;
    const laughCache = new Map();
    try {
      const laughRows = chatDb.prepare(
        "SELECT c.chat_identifier as chat_name, m.is_from_me, m.text " +
        "FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id " +
        "JOIN chat c ON cmj.chat_id = c.ROWID WHERE m.text IS NOT NULL AND (" +
        "m.text LIKE '%lol%' OR m.text LIKE '%lmao%' OR m.text LIKE '%haha%' OR m.text LIKE '%hehe%' " +
        "OR m.text LIKE '%rofl%' OR m.text LIKE '%lmfao%' OR m.text LIKE '%im dead%' OR m.text LIKE '%i cant%' " +
        "OR m.text LIKE '%dying%' " +
        "OR m.text LIKE '%\\xF0\\x9F\\x98\\x82%' OR m.text LIKE '%\\xF0\\x9F\\xA4\\xA3%' OR m.text LIKE '%\\xF0\\x9F\\x92\\x80%' OR m.text LIKE '%\\xE2\\x98\\xA0%')"
      ).all();
      for (const row of laughRows) {
        const isLaugh = LAUGH_RE.test(row.text) || LAUGH_EMOJI.test(row.text);
        if (!isLaugh) continue;
        if (!laughCache.has(row.chat_name)) laughCache.set(row.chat_name, { generated: 0, received: 0 });
        const entry = laughCache.get(row.chat_name);
        if (row.is_from_me === 1) entry.received++; else entry.generated++;
      }
    } catch {}

    // Method 2: Tapback "Laughed at" reactions (associated_message_type 2003)
    try {
      const tapbackRows = chatDb.prepare(
        "SELECT c.chat_identifier as chat_name, m.is_from_me " +
        "FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id " +
        "JOIN chat c ON cmj.chat_id = c.ROWID WHERE m.associated_message_type = 2003"
      ).all();
      for (const row of tapbackRows) {
        if (!laughCache.has(row.chat_name)) laughCache.set(row.chat_name, { generated: 0, received: 0 });
        const entry = laughCache.get(row.chat_name);
        if (row.is_from_me === 1) entry.received++; else entry.generated++;
      }
    } catch {}

    // Late night ratio
    const lateNightCache = new Map();
    try {
      const lnRows = chatDb.prepare(
        "SELECT c.chat_identifier as chat_name, COUNT(*) as total, " +
        "SUM(CASE WHEN CAST(strftime('%H', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) >= 23 THEN 1 " +
        "WHEN CAST(strftime('%H', datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) < 4 THEN 1 ELSE 0 END) as late_night_count " +
        "FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id " +
        "JOIN chat c ON cmj.chat_id = c.ROWID WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1)" + dateCond + " GROUP BY c.chat_identifier"
      ).all();
      for (const r of lnRows) { if (r.total > 0 && r.late_night_count > 0) lateNightCache.set(r.chat_name, Math.round((r.late_night_count / r.total) * 100)); }
    } catch {}

    // Reply latency
    const replyCache = new Map();
    try {
      const latRows = chatDb.prepare(
        "WITH ordered AS (SELECT c.chat_identifier as chat_name, m.date, m.is_from_me, " +
        "LAG(m.date) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_date, " +
        "LAG(m.is_from_me) OVER (PARTITION BY cmj.chat_id ORDER BY m.date) as prev_from_me " +
        "FROM message m JOIN chat_message_join cmj ON m.ROWID = cmj.message_id " +
        "JOIN chat c ON cmj.chat_id = c.ROWID WHERE m.is_from_me IN (0, 1) AND m.date > 0) " +
        "SELECT chat_name, AVG(CAST(date - prev_date AS REAL) / 1000000000.0 / 60.0) as avg_minutes " +
        "FROM ordered WHERE is_from_me = 1 AND prev_from_me = 0 AND (date - prev_date) > 0 " +
        "AND (date - prev_date) < 86400000000000 GROUP BY chat_name HAVING COUNT(*) >= 3"
      ).all();
      for (const row of latRows) replyCache.set(row.chat_name, Math.round(row.avg_minutes));
    } catch {}

    // Peak hour/weekday
    try {
      const phr = chatDb.prepare("SELECT CAST(strftime('%H', datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as hr, COUNT(*) as c FROM message m WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1) AND m.is_from_me = 1" + dateCond + " GROUP BY hr ORDER BY c DESC LIMIT 1").get();
      if (phr) globalPeakHour = phr.hr;
      const pdw = chatDb.prepare("SELECT CAST(strftime('%w', datetime(m.date / 1000000000 + 978307200, 'unixepoch', 'localtime')) AS INTEGER) as dow, COUNT(*) as c FROM message m WHERE (m.text IS NOT NULL OR m.cache_has_attachments = 1) AND m.is_from_me = 1" + dateCond + " GROUP BY dow ORDER BY c DESC LIMIT 1").get();
      if (pdw) globalPeakWeekday = pdw.dow;
    } catch {}

    for (const r of rows) {
      const laughs = laughCache.get(r.chat_name);
      msgStats.set(r.chat_name, {
        messageCount: r.message_count, sentCount: r.sent_count, receivedCount: r.received_count,
        initiationCount: initMap.get(r.chat_name) || 0,
        laughsGenerated: laughs ? laughs.generated : 0, laughsReceived: laughs ? laughs.received : 0,
        lateNightRatio: lateNightCache.get(r.chat_name) || 0,
        avgReplyMinutes: replyCache.get(r.chat_name) || 0
      });
    }
    chatDb.close();
  }

  // Build chatNames
  const chatNames = chatDetails.map(r => {
    let ms = msgStats.get(r.chat_name);
    if (!ms) { const bridged = displayToIdentifier.get(r.chat_name); if (bridged) ms = msgStats.get(bridged); }
    const pCount = participantMap.get(r.chat_name) || 1;
    let isGroup = pCount > 1;
    if (!isGroup) { const bridged = displayToIdentifier.get(r.chat_name); if (bridged) isGroup = (participantMap.get(bridged) || 1) > 1; }
    return {
      rawName: r.chat_name, attachmentCount: r.attachment_count, lastMessageDate: r.last_message_date || '',
      messageCount: ms ? ms.messageCount : 0, sentCount: ms ? ms.sentCount : 0, receivedCount: ms ? ms.receivedCount : 0,
      initiationCount: ms ? ms.initiationCount : 0, laughsGenerated: ms ? ms.laughsGenerated : 0, laughsReceived: ms ? ms.laughsReceived : 0,
      isGroup: isGroup, lateNightRatio: ms ? ms.lateNightRatio : 0, avgReplyMinutes: ms ? ms.avgReplyMinutes : 0
    };
  });

  d.close();
  parentPort.postMessage({ result: { total, images, videos, documents, audio, unavailable, chatNames, globalPeakHour, globalPeakWeekday } });
} catch (err) {
  parentPort.postMessage({ error: String(err) });
}
`)
  return workerPath
}

function runStatsInWorker(chatNameFilter?: string, dateFrom?: string, dateTo?: string): Promise<ReturnType<typeof getStats>> {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const workerPath = getStatsWorkerPath()
    const stashDbPath = join(app.getPath('appData'), 'Stash', 'stash.db')
    const worker = new Worker(workerPath, {
      workerData: { stashDbPath, chatNameFilter: chatNameFilter || null, dateFrom: dateFrom || null, dateTo: dateTo || null }
    })
    worker.on('message', (msg: { result?: unknown; error?: string }) => {
      console.log(`[PERF][WORKER] getStats: ${Date.now()-t0}ms`)
      if (msg.error) { console.error('[WORKER] getStats error:', msg.error); reject(new Error(msg.error)) }
      else resolve(msg.result as ReturnType<typeof getStats>)
      worker.terminate()
    })
    worker.on('error', (err) => { console.error('[WORKER] getStats crash:', err); reject(err) })
    worker.on('exit', (code) => { if (code !== 0) reject(new Error(`Worker exited with code ${code}`)) })
  })
}

function setupIpc(): void {
  ipcMain.handle('check-disk-access', () => { console.log('[IPC] check-disk-access called'); return checkFullDiskAccess() })

  ipcMain.handle('search-attachments', (_event, query: string, filters: Record<string, string>, page: number, limit: number, sortOrder?: string) => {
    return searchAttachments(query, filters, page, limit, sortOrder)
  })

  ipcMain.handle('get-attachments', (_event, filters: Record<string, string>, page: number, limit: number, sortOrder?: string) => {
    return searchAttachments('', filters, page, limit, sortOrder)
  })

  ipcMain.handle('get-stats', async (_event, chatNameFilter?: string, dateFrom?: string, dateTo?: string) => {
    const ipcStart = Date.now()
    await dbReady
    console.log(`[PERF] getStats: dbReady after ${Date.now()-ipcStart}ms`)
    const cacheKey = 'getStats_' + `stats:${chatNameFilter || 'all'}:${dateFrom || ''}:${dateTo || ''}`.replace(/[^a-z0-9]/gi, '_')
    const signal = getMessageCountSignal()
    const cached = getCachedAnalytics<unknown>(cacheKey, signal)
    if (cached) { console.log(`[PERF][CACHE HIT] getStats (${Date.now()-ipcStart}ms total)`); return cached }

    // Deduplicate: if a worker is already running, wait for it
    if (statsWorkerPromise) {
      console.log(`[PERF] getStats: joining in-flight worker (${Date.now()-ipcStart}ms since request)`)
      return statsWorkerPromise
    }

    console.log(`[PERF] getStats: spawning worker thread (cold, ${Date.now()-ipcStart}ms since request)`)
    const workerPromise = (async () => {
      try {
        const stats = await runStatsInWorker(chatNameFilter, dateFrom, dateTo)

        // Contact resolution runs on main thread (needs compiled Swift binary, fast ~200ms)
        const t1 = Date.now()
        const chatNameMap: Record<string, string> = {}
        try {
          compileContactsHelper()
          const handles = (stats.chatNames as { rawName: string }[]).map(c => c.rawName).filter(n => n && (n.startsWith('+') || n.includes('@')))
          if (handles.length > 0) resolveContactsBatch(handles)
          for (const chat of stats.chatNames as { rawName: string; isGroup: boolean }[]) {
            const name = chat.rawName
            if (!name) continue
            if (name.startsWith('+') || name.includes('@')) {
              const resolved = resolveContact(name)
              chatNameMap[name] = (resolved && resolved !== name) ? resolved : name
            } else if (/^chat\d+/i.test(name) || name.includes(';')) {
              chatNameMap[name] = chat.isGroup ? `Group · ${name.length > 20 ? 'chat' : name}` : 'Group chat'
            } else {
              chatNameMap[name] = name.startsWith('#') ? 'Group chat' : name
            }
          }
        } catch {
          for (const c of stats.chatNames as { rawName: string }[]) chatNameMap[c.rawName] = c.rawName
        }
        console.log(`[PERF][MAIN] getStats contacts: ${Date.now()-t1}ms`)

        const result = { ...stats, chatNameMap }
        setCachedAnalytics(cacheKey, signal, result)
        return result
      } finally {
        statsWorkerPromise = null
      }
    })()

    statsWorkerPromise = workerPromise
    return workerPromise
  })
  ipcMain.handle('get-today-in-history', async () => { await dbReady; return getTodayInHistory() })
  ipcMain.handle('get-usage-stats', async (_event, dateFrom?: string, dateTo?: string) => { await dbReady; return getUsageStats(dateFrom, dateTo) })
  ipcMain.handle('search-messages', (_event, query: string, chatName?: string, limit?: number) => searchMessages(query, chatName, limit))
  ipcMain.handle('get-message-index-status', () => getMessageIndexStatus())
  ipcMain.handle('get-vocab-stats', (_event, chatName?: string) => getVocabStats(chatName))
  ipcMain.handle('get-word-origins', (_event, chatName?: string) => getWordOrigins(chatName, 5))
  ipcMain.handle('save-share-card', async (_event, dataUrl: string, filename: string) => {
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: filename, filters: [{ name: 'PNG Image', extensions: ['png'] }] })
    if (result.canceled || !result.filePath) return false
    const { writeFileSync } = require('fs')
    writeFileSync(result.filePath, Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64'))
    return true
  })
  // ── Heavy analytics: cached + event-loop-yielding ──
  ipcMain.handle('get-messaging-network', async () => {
    const signal = getMessageCountSignal()
    const cached = getCachedAnalytics<ReturnType<typeof getMessagingNetwork>>('messagingNetwork', signal)
    if (cached) return cached
    await yieldEventLoop()
    const t0 = Date.now()
    const result = getMessagingNetwork()
    console.log(`[PERF][COMPUTE] getMessagingNetwork: ${Date.now()-t0}ms`)
    setCachedAnalytics('messagingNetwork', signal, result)
    return result
  })
  ipcMain.handle('get-relationship-timeline', (_event, chatIdentifier: string) => getRelationshipTimeline(chatIdentifier))
  ipcMain.handle('get-social-gravity', async () => {
    const signal = getMessageCountSignal()
    const cached = getCachedAnalytics<ReturnType<typeof getSocialGravity>>('socialGravity', signal)
    if (cached) return cached
    await yieldEventLoop()
    const t0 = Date.now()
    const result = getSocialGravity()
    console.log(`[PERF][COMPUTE] getSocialGravity: ${Date.now()-t0}ms`)
    setCachedAnalytics('socialGravity', signal, result)
    return result
  })
  ipcMain.handle('get-topic-eras', async () => {
    const signal = getMessageCountSignal()
    const cached = getCachedAnalytics<ReturnType<typeof getTopicEras>>('topicEras', signal)
    if (cached) return cached
    await yieldEventLoop()
    const t0 = Date.now()
    const result = getTopicEras()
    console.log(`[PERF][COMPUTE] getTopicEras: ${Date.now()-t0}ms`)
    setCachedAnalytics('topicEras', signal, result)
    return result
  })
  ipcMain.handle('get-memory-moments', async () => {
    const signal = getMessageCountSignal()
    const cached = getCachedAnalytics<ReturnType<typeof getMemoryMoments>>('memoryMoments', signal)
    if (cached) return cached
    await yieldEventLoop()
    const t0 = Date.now()
    const result = getMemoryMoments()
    console.log(`[PERF][COMPUTE] getMemoryMoments: ${Date.now()-t0}ms`)
    setCachedAnalytics('memoryMoments', signal, result)
    return result
  })
  ipcMain.handle('get-fast-stats', async (_event, chatNameFilter?: string, dateFrom?: string, dateTo?: string) => {
    console.log('[IPC] get-fast-stats called, awaiting dbReady...')
    await dbReady
    console.log('[IPC] get-fast-stats: dbReady, computing...')
    const result = { ...getFastStats(chatNameFilter, dateFrom, dateTo), chatNameMap: {} }
    console.log(`[IPC] get-fast-stats: done, total=${result.total}`)
    return result
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
      invalidateSignalCache() // new data means caches should refresh
    }
  })
  ipcMain.handle('get-chat-summaries', () => fetchChatSummaries())
  ipcMain.handle('resolve-chat-names', () => { resolveNamesInBackground(mainWindow) })
  ipcMain.handle('save-chat-priorities', (_event, chats: string[]) => { saveChatPriorities(chats) })
  ipcMain.handle('get-saved-priority-chats', () => getSavedPriorityChats())
  ipcMain.handle('reset-indexing', () => { resetIndexing() })
  ipcMain.handle('recover-from-icloud', async (_event, id: number) => recoverAttachment(id))
  ipcMain.handle('get-conversation-stats', (_event, chatIdentifier: string, isGroup: boolean) => getConversationStats(chatIdentifier, isGroup))

  // ── AI service layer (centralized in ai.ts) ──
  ipcMain.handle('set-anthropic-key', (_event, key: string) => setApiKey(key))
  ipcMain.handle('get-ai-status', () => getAIStatus())
  ipcMain.handle('search-conversations-ai', async (_event, description: string, conversations: { display: string; identifier: string }[]) => {
    return searchConversationsAI(description, conversations)
  })
  ipcMain.handle('enrich-topic-eras', async (_event, eras: TopicEraSummaryInput[]) => {
    console.log('[IPC] enrich-topic-eras called, eras:', eras.length)
    const result = await enrichTopicEras(eras)
    console.log('[IPC] enrich-topic-eras result:', result ? result.length + ' items' : 'null')
    return result
  })
  ipcMain.handle('get-topic-era-context', async (_event, chapters: { startYear: number; endYear: number; topicLabel: string; keywords: string[] }[]) => {
    const signal = getMessageCountSignal() + ':' + JSON.stringify(chapters.map(c => `${c.startYear}-${c.endYear}`))
    const cached = getCachedAnalytics<ReturnType<typeof getTopicEraContext>>('topicEraContext', signal)
    if (cached) return cached
    await yieldEventLoop()
    const t0 = Date.now()
    const result = getTopicEraContext(chapters)
    console.log(`[PERF][COMPUTE] getTopicEraContext: ${Date.now()-t0}ms`)
    setCachedAnalytics('topicEraContext', signal, result)
    return result
  })
  ipcMain.handle('enrich-topic-eras-v2', async (_event, contexts: TopicEraContextInput[]) => {
    console.log('[IPC] enrich-topic-eras-v2 called, contexts:', contexts.length)
    const result = await enrichTopicErasV2(contexts)
    console.log('[IPC] enrich-topic-eras-v2 result:', result ? result.length + ' items' : 'null')
    return result
  })
  ipcMain.handle('enrich-memory-moments', async (_event, moments: MemoryMomentSummaryInput[]) => enrichMemoryMoments(moments))
  ipcMain.handle('interpret-search-query', async (_event, query: string) => interpretSearchQuery(query))
  ipcMain.handle('search-messages-aggregated', (_event, phrase: string, chatName?: string) => searchMessagesAggregated(phrase, chatName))
  ipcMain.handle('execute-search-intent', async (_event, query: string, chatName?: string) => {
    // 1. Try local signal detection first (no AI needed)
    const localSignal = detectSignalQuery(query)
    if (localSignal) {
      console.log(`[Search] Local signal detected: ${localSignal.signal}`)
      return executeSearchIntent({ ...localSignal, limit: 10, sort: 'desc' }, chatName)
    }
    // 2. Try AI intent parsing
    try {
      const intent = await interpretSearchQuery(query)
      if (intent && intent.type !== 'literal') {
        console.log(`[Search] AI intent: ${intent.type}/${intent.signal || intent.phrase}`)
        return executeSearchIntent(intent, chatName)
      }
    } catch { /* fall through */ }
    // 3. Fallback: literal FTS search
    const results = searchMessages(query, chatName, 30)
    return { type: 'messages', explanation: `Showing messages matching "${query}"`, messages: results }
  })
  ipcMain.handle('refresh-reactions', () => { updateReactionCounts() })
  ipcMain.handle('hide-chat', (_event, chatIdentifier: string) => { hideChat(chatIdentifier) })
  ipcMain.handle('get-hidden-chats', () => getHiddenChats())
  ipcMain.handle('get-conversation-signals', (_event, chatIdentifier?: string) => getConversationSignals(chatIdentifier))
  ipcMain.handle('get-analysis-progress', () => getAnalysisProgress())
  ipcMain.handle('get-significant-photos', (_event, chatIdentifier: string) => getSignificantPhotos(chatIdentifier))
  ipcMain.handle('get-relationship-dynamics', (_event, chatIdentifier: string) => getRelationshipDynamics(chatIdentifier))
  ipcMain.handle('get-message-samples', (_event, chatIdentifier: string) => getMessageSamples(chatIdentifier))
  ipcMain.handle('get-attachment-context', (_event, attachmentId: number) => getAttachmentContext(attachmentId))
  ipcMain.handle('summarize-conversation', async (_event, chatIdentifier: string, contactName: string) => {
    const samples = getMessageSamples(chatIdentifier)
    return summarizeConversation(chatIdentifier, contactName, samples)
  })
  ipcMain.handle('generate-relationship-narrative', async (_event, chatIdentifier: string, contactName: string, stats: unknown) =>
    generateRelationshipNarrative(chatIdentifier, contactName, stats as Parameters<typeof generateRelationshipNarrative>[2])
  )
  ipcMain.handle('generate-attachment-caption', async (_event, chatIdentifier: string, contactName: string, attachmentInfo: unknown, surroundingMessages: unknown[]) =>
    generateAttachmentCaption(chatIdentifier, contactName, attachmentInfo as Parameters<typeof generateAttachmentCaption>[2], surroundingMessages as Parameters<typeof generateAttachmentCaption>[3])
  )
  ipcMain.handle('get-closeness-scores', (_event, chatIdentifier?: string) => getClosenessScores(chatIdentifier))
  ipcMain.handle('get-closeness-rank', (_event, chatIdentifier: string) => getClosenessRank(chatIdentifier))
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
  const bootStart = Date.now()
  app.setName('Stash')

  // DB init runs before window — schema creation is fast, backfill is the slow part
  const t0 = Date.now()
  initDb()
  console.log(`[PERF][BOOT] initDb: ${Date.now()-t0}ms`)
  invalidateLaughCache()
  const t1 = Date.now()
  compileContactsHelper()
  console.log(`[PERF][BOOT] compileContactsHelper: ${Date.now()-t1}ms`)
  dbReadyResolve()

  createMenu()
  createTray()
  setupLoginItem()
  setupIpc()
  createWindow()
  console.log(`[PERF][BOOT] Total boot to window created: ${Date.now()-bootStart}ms`)

  // Deferred reaction count sync
  setTimeout(() => { try { updateReactionCounts() } catch (e) { console.error('[Reactions]', e) } }, 3000)

  // Deferred message analysis pipeline (5s after boot — after reactions, after cache is warm)
  setTimeout(() => {
    runMessageAnalysis(mainWindow!).catch(e => console.error('[MessageAnalysis] Failed:', e))
  }, 5000)

  // Deferred closeness computation (10s after boot — after pipeline has had time to run)
  setTimeout(() => {
    computeClosenessScores(mainWindow!).catch(e => console.error('[Closeness] Failed:', e))
  }, 10000)

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
