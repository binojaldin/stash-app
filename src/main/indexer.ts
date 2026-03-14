import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { basename, extname } from 'path'
import sharp from 'sharp'
import { watch } from 'chokidar'
import { readAllAttachments, MessageAttachment } from './messagesReader'
import { initDb, insertAttachment, isAlreadyIndexed, getThumbnailDir, updateOcrText } from './db'
import { compileOcrHelper, runOcr } from './ocr'
import { join } from 'path'
import { homedir } from 'os'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.tiff', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv'])

let isIndexing = false
let indexingProgress = { total: 0, processed: 0, currentFile: '' }

function classifyFile(ext: string, mime: string | null): { is_image: number; is_video: number; is_document: number } {
  const lExt = ext.toLowerCase()
  if (IMAGE_EXTENSIONS.has(lExt) || mime?.startsWith('image/')) return { is_image: 1, is_video: 0, is_document: 0 }
  if (VIDEO_EXTENSIONS.has(lExt) || mime?.startsWith('video/')) return { is_image: 0, is_video: 1, is_document: 0 }
  if (DOCUMENT_EXTENSIONS.has(lExt) || mime?.startsWith('application/pdf') || mime?.startsWith('text/')) return { is_image: 0, is_video: 0, is_document: 1 }
  return { is_image: 0, is_video: 0, is_document: 0 }
}

async function generateThumbnail(filePath: string, ext: string): Promise<string | null> {
  const lExt = ext.toLowerCase()
  if (!IMAGE_EXTENSIONS.has(lExt)) return null
  if (lExt === '.heic') return null // sharp may not support HEIC without additional deps

  try {
    const thumbDir = getThumbnailDir()
    const thumbName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
    const thumbPath = join(thumbDir, thumbName)
    await sharp(filePath).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbPath)
    return thumbPath
  } catch (err) {
    console.error('Thumbnail error:', filePath, err)
    return null
  }
}

function sendProgress(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('indexing-progress', { ...indexingProgress })
  }
}

export async function startIndexing(win: BrowserWindow | null): Promise<void> {
  if (isIndexing) return
  isIndexing = true

  initDb()
  compileOcrHelper()

  const attachments = readAllAttachments()
  const toProcess = attachments.filter(
    (a) => a.original_path && !isAlreadyIndexed(a.original_path)
  )

  indexingProgress = { total: toProcess.length, processed: 0, currentFile: '' }
  sendProgress(win)

  for (const att of toProcess) {
    if (!att.original_path || !existsSync(att.original_path)) {
      indexingProgress.processed++
      sendProgress(win)
      continue
    }

    const ext = extname(att.filename || att.original_path || '')
    const fname = basename(att.filename || att.original_path || 'unknown')
    indexingProgress.currentFile = fname
    sendProgress(win)

    const classification = classifyFile(ext, att.mime_type)
    const thumbnailPath = await generateThumbnail(att.original_path, ext)

    const id = insertAttachment({
      filename: fname,
      original_path: att.original_path,
      stash_path: null,
      file_size: att.file_size,
      mime_type: att.mime_type,
      created_at: att.created_at,
      chat_name: att.chat_name,
      sender_handle: att.sender_handle,
      thumbnail_path: thumbnailPath,
      file_extension: ext,
      ...classification,
      ocr_text: null
    })

    // Run OCR in background for images
    if (id && classification.is_image && att.original_path) {
      const ocrPath = att.original_path
      runOcr(ocrPath).then((text) => {
        if (text) updateOcrText(id, text)
      })
    }

    indexingProgress.processed++
    sendProgress(win)
  }

  isIndexing = false
  indexingProgress.currentFile = ''
  sendProgress(win)

  // Watch for new attachments
  const attachmentsDir = join(homedir(), 'Library/Messages/Attachments')
  if (existsSync(attachmentsDir)) {
    const watcher = watch(attachmentsDir, {
      ignoreInitial: true,
      persistent: true,
      depth: 10
    })

    watcher.on('add', async (filePath) => {
      if (isAlreadyIndexed(filePath)) return
      // Re-read messages DB to get metadata for this file
      const allAtts = readAllAttachments()
      const match = allAtts.find((a) => a.original_path === filePath)
      if (!match) return

      const ext = extname(filePath)
      const fname = basename(filePath)
      const classification = classifyFile(ext, match.mime_type)
      const thumbnailPath = await generateThumbnail(filePath, ext)

      const id = insertAttachment({
        filename: fname,
        original_path: filePath,
        stash_path: null,
        file_size: match.file_size,
        mime_type: match.mime_type,
        created_at: match.created_at,
        chat_name: match.chat_name,
        sender_handle: match.sender_handle,
        thumbnail_path: thumbnailPath,
        file_extension: ext,
        ...classification,
        ocr_text: null
      })

      if (id && classification.is_image) {
        runOcr(filePath).then((text) => {
          if (text) updateOcrText(id, text)
        })
      }

      if (win && !win.isDestroyed()) {
        win.webContents.send('new-attachment-indexed')
      }
    })
  }
}

export function getIndexingProgress(): typeof indexingProgress {
  return { ...indexingProgress }
}

export function isCurrentlyIndexing(): boolean {
  return isIndexing
}
