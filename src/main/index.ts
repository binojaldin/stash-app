import { app, shell, BrowserWindow, ipcMain, dialog, Menu } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { checkFullDiskAccess } from './messagesReader'
import { initDb, searchAttachments, getStats, getAttachmentById, closeDb } from './db'
import { startIndexing, getIndexingProgress, fetchChatSummaries, saveChatPriorities, getSavedPriorityChats, resetIndexing, recoverAttachment } from './indexer'
import { copyFileSync, existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null

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
          click: (): void => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('focus-search')
            }
          }
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
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

  ipcMain.handle('get-stats', () => getStats())
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
  ipcMain.handle('start-indexing', (_event, priorityChats?: string[]) => { startIndexing(mainWindow, priorityChats) })
  ipcMain.handle('get-chat-summaries', () => fetchChatSummaries())
  ipcMain.handle('save-chat-priorities', (_event, chats: string[]) => { saveChatPriorities(chats) })
  ipcMain.handle('get-saved-priority-chats', () => getSavedPriorityChats())
  ipcMain.handle('reset-indexing', () => { resetIndexing() })
  ipcMain.handle('recover-from-icloud', async (_event, id: number) => recoverAttachment(id))
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
    if (filePath && existsSync(filePath)) return `file://${filePath}`
    return null
  })
}

app.whenReady().then(() => {
  initDb()
  createMenu()
  setupIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') { closeDb(); app.quit() }
})

app.on('before-quit', () => { closeDb() })
