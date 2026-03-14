import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { checkFullDiskAccess } from './messagesReader'
import { initDb, searchAttachments, getStats, getAttachmentById, closeDb } from './db'
import { startIndexing, getIndexingProgress } from './indexer'
import { copyFileSync, existsSync } from 'fs'

let mainWindow: BrowserWindow | null = null

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
  ipcMain.handle('check-disk-access', () => {
    return checkFullDiskAccess()
  })

  ipcMain.handle('search-attachments', (_event, query: string, filters: Record<string, string>, page: number, limit: number) => {
    return searchAttachments(query, filters, page, limit)
  })

  ipcMain.handle('get-attachments', (_event, filters: Record<string, string>, page: number, limit: number) => {
    return searchAttachments('', filters, page, limit)
  })

  ipcMain.handle('get-stats', () => {
    return getStats()
  })

  ipcMain.handle('get-attachment', (_event, id: number) => {
    return getAttachmentById(id)
  })

  ipcMain.handle('open-in-finder', (_event, filePath: string) => {
    if (existsSync(filePath)) {
      shell.showItemInFolder(filePath)
      return true
    }
    return false
  })

  ipcMain.handle('export-file', async (_event, id: number) => {
    const att = getAttachmentById(id)
    if (!att || !existsSync(att.original_path)) return false

    const result = await dialog.showSaveDialog(mainWindow!, {
      defaultPath: att.filename,
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })

    if (!result.canceled && result.filePath) {
      copyFileSync(att.original_path, result.filePath)
      return true
    }
    return false
  })

  ipcMain.handle('get-indexing-progress', () => {
    return getIndexingProgress()
  })

  ipcMain.handle('start-indexing', () => {
    startIndexing(mainWindow)
  })

  ipcMain.handle('get-file-url', (_event, filePath: string) => {
    if (filePath && existsSync(filePath)) {
      return `file://${filePath}`
    }
    return null
  })
}

app.whenReady().then(() => {
  initDb()
  setupIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb()
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDb()
})
