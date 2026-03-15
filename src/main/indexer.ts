import { BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import sharp from 'sharp'
import { watch } from 'chokidar'
import { readAllAttachments, MessageAttachment, getChatSummaries } from './messagesReader'
import type { ChatSummary } from './messagesReader'
import {
  initDb,
  insertAttachment,
  isAlreadyIndexed,
  getThumbnailDir,
  updateOcrText,
  updateThumbnail,
  markFullyIndexed,
  getMetadataOnlyByPath,
  getIdByPath,
  updateAvailability,
  clearAllAttachments,
  getAttachmentById
} from './db'
import { compileOcrHelper, runOcr } from './ocr'
import { compileContactsHelper, resolveContact, resolveContactsBatch } from './contacts'
import { compileIcloudHelper, triggerBrctlSync, recoverFile } from './icloud'
import { homedir } from 'os'
import { app } from 'electron'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.tiff', '.bmp'])
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.flac', '.aiff'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.csv'])

let isIndexing = false
let indexingProgress = { total: 0, processed: 0, currentFile: '', phase: '' }

function classifyFile(ext: string, mime: string | null): { is_image: number; is_video: number; is_document: number } {
  const lExt = ext.toLowerCase()
  if (IMAGE_EXTENSIONS.has(lExt) || mime?.startsWith('image/')) return { is_image: 1, is_video: 0, is_document: 0 }
  if (VIDEO_EXTENSIONS.has(lExt) || mime?.startsWith('video/')) return { is_image: 0, is_video: 1, is_document: 0 }
  if (DOCUMENT_EXTENSIONS.has(lExt) || mime?.startsWith('application/pdf') || mime?.startsWith('text/')) return { is_image: 0, is_video: 0, is_document: 1 }
  return { is_image: 0, is_video: 0, is_document: 0 }
}

function isAudio(ext: string, mime: string | null): boolean {
  return AUDIO_EXTENSIONS.has(ext.toLowerCase()) || !!mime?.startsWith('audio/')
}

async function generateThumbnail(filePath: string, ext: string): Promise<string | null> {
  const lExt = ext.toLowerCase()
  if (!IMAGE_EXTENSIONS.has(lExt)) return null

  const thumbDir = getThumbnailDir()
  const thumbName = `${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
  const thumbPath = join(thumbDir, thumbName)

  // Try sharp first (fast, handles most formats)
  if (lExt !== '.heic' && lExt !== '.heif') {
    try {
      await sharp(filePath).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(thumbPath)
      return thumbPath
    } catch { /* fall through to sips */ }
  }

  // Fallback: use macOS sips for HEIC and any sharp failures
  try {
    const { execSync } = require('child_process')
    execSync(`sips -s format jpeg -Z 400 "${filePath}" --out "${thumbPath}"`, { timeout: 15000, stdio: 'ignore' })
    if (existsSync(thumbPath)) return thumbPath
  } catch { /* ignore */ }

  return null
}

function sendProgress(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send('indexing-progress', { ...indexingProgress })
  }
}

function getPrefsPath(): string {
  return join(app.getPath('appData'), 'Stash', 'prefs.json')
}

function loadPriorityChats(): string[] | null {
  const prefsPath = getPrefsPath()
  if (!existsSync(prefsPath)) return null
  try { return JSON.parse(readFileSync(prefsPath, 'utf-8')).priorityChats ?? null }
  catch { return null }
}

function savePriorityChats(chats: string[]): void {
  const prefsPath = getPrefsPath()
  let prefs: Record<string, unknown> = {}
  if (existsSync(prefsPath)) {
    try { prefs = JSON.parse(readFileSync(prefsPath, 'utf-8')) } catch { /* ignore */ }
  }
  prefs.priorityChats = chats
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
}

export interface ResolvedChatSummary {
  chat_id: number
  chat_name: string
  display_name: string
  raw_chat_identifier: string
  attachment_count: number
  last_message_date: string
  participant_handles: string[]
}

function isGroupChatIdentifier(identifier: string): boolean {
  return /^chat\d+/.test(identifier)
}

function resolveDisplayName(summary: ChatSummary): string {
  // Named group chats with proper display names (not hash/phone/email/chat IDs)
  if (summary.display_name && !summary.display_name.startsWith('+') && !summary.display_name.includes('@') && !summary.display_name.startsWith('#') && !isGroupChatIdentifier(summary.display_name)) {
    return summary.display_name
  }
  // Group chats (by identifier pattern or hash prefix)
  if ((isGroupChatIdentifier(summary.raw_chat_identifier) || summary.chat_name?.startsWith('#') || summary.display_name?.startsWith('#')) && summary.participant_handles.length > 0) {
    const count = summary.participant_handles.length + 1
    return `Group chat · ${count} members`
  }
  if (summary.chat_name?.startsWith('#') || summary.display_name?.startsWith('#')) {
    return 'Group chat'
  }
  // Single chat — resolve handle
  const identifier = summary.raw_chat_identifier || summary.chat_name
  if (identifier && (identifier.startsWith('+') || identifier.includes('@'))) return resolveContact(identifier)
  return summary.chat_name
}

// Returns raw data instantly — no contact resolution
export function fetchChatSummaries(): ResolvedChatSummary[] {
  const summaries = getChatSummaries()
  return summaries.map((s) => ({
    chat_id: s.chat_id,
    chat_name: s.chat_name,
    display_name: s.display_name || s.chat_name,
    raw_chat_identifier: s.raw_chat_identifier,
    attachment_count: s.attachment_count,
    last_message_date: s.last_message_date,
    participant_handles: s.participant_handles
  }))
}

// Resolves contact names in background, sends IPC when done
export function resolveNamesInBackground(win: BrowserWindow | null): void {
  setTimeout(() => {
    compileContactsHelper()
    const summaries = getChatSummaries()
    const allHandles: string[] = []
    for (const s of summaries) {
      const id = s.raw_chat_identifier || s.chat_name
      if (id && (id.startsWith('+') || id.includes('@'))) allHandles.push(id)
      for (const h of s.participant_handles) allHandles.push(h)
    }
    resolveContactsBatch([...new Set(allHandles)])
    const resolved = summaries.map((s) => ({
      chat_id: s.chat_id,
      chat_name: s.chat_name,
      display_name: resolveDisplayName(s),
      raw_chat_identifier: s.raw_chat_identifier,
      attachment_count: s.attachment_count,
      last_message_date: s.last_message_date,
      participant_handles: s.participant_handles
    }))
    if (win && !win.isDestroyed()) {
      win.webContents.send('chat-names-resolved', resolved)
    }
  }, 100)
}

export function saveChatPriorities(chats: string[]): void { savePriorityChats(chats) }
export function getSavedPriorityChats(): string[] | null { return loadPriorityChats() }

export function resetIndexing(): void {
  clearAllAttachments()
  const prefsPath = getPrefsPath()
  if (existsSync(prefsPath)) {
    try {
      const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'))
      delete prefs.priorityChats
      writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
    } catch { /* ignore */ }
  }
}

// Scan for orphaned files in Messages/Attachments not in our DB
function scanOrphanedFiles(): { filePath: string; filename: string; fileSize: number; mtime: string }[] {
  const attachmentsDir = join(homedir(), 'Library/Messages/Attachments')
  if (!existsSync(attachmentsDir)) return []
  const orphans: { filePath: string; filename: string; fileSize: number; mtime: string }[] = []

  function walk(dir: string, depth: number): void {
    if (depth > 10) return
    try {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) { walk(full, depth + 1) }
        else if (entry.isFile() && !entry.name.startsWith('.')) {
          if (!isAlreadyIndexed(full)) {
            try {
              const st = statSync(full)
              orphans.push({ filePath: full, filename: entry.name, fileSize: st.size, mtime: st.mtime.toISOString() })
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* permission error */ }
  }

  walk(attachmentsDir, 0)
  return orphans
}

export async function recoverAttachment(id: number): Promise<boolean> {
  const att = getAttachmentById(id)
  if (!att || !att.original_path) return false
  if (existsSync(att.original_path)) {
    updateAvailability(id, 1)
    return true
  }
  const ok = await recoverFile(att.original_path)
  if (!ok) return false
  // Wait and check
  await new Promise((r) => setTimeout(r, 5000))
  if (existsSync(att.original_path)) {
    updateAvailability(id, 1)
    // Generate thumbnail + OCR
    const ext = extname(att.original_path)
    const thumb = await generateThumbnail(att.original_path, ext)
    if (thumb) updateThumbnail(id, thumb)
    if (att.is_image) {
      const text = await runOcr(att.original_path)
      if (text) updateOcrText(id, text)
    }
    return true
  }
  return false
}

export async function startIndexing(win: BrowserWindow | null, selectedChats?: string[]): Promise<void> {
  if (isIndexing) return
  isIndexing = true

  initDb()
  compileOcrHelper()
  compileIcloudHelper()

  // Save selected chats if provided
  if (selectedChats) savePriorityChats(selectedChats)
  const savedSelection = selectedChats ?? loadPriorityChats() ?? []
  const selectionSet = new Set(savedSelection)
  const hasSelection = selectionSet.size > 0

  // ── Pre-flight: trigger iCloud sync on first launch ──
  const prefsPath = getPrefsPath()
  const isFirstRun = selectedChats !== undefined // first time = user just came from priority screen
  if (isFirstRun) {
    indexingProgress = { total: 0, processed: 0, currentFile: '', phase: 'Syncing with iCloud...' }
    sendProgress(win)
    await triggerBrctlSync()
  }

  const allAttachments = readAllAttachments()
  const targetAttachments = hasSelection
    ? allAttachments.filter((a) => a.chat_name && selectionSet.has(a.chat_name))
    : allAttachments

  // ── Phase 1: Metadata-only insert (all records, regardless of file existence) ──
  indexingProgress = { total: targetAttachments.length, processed: 0, currentFile: '', phase: 'Cataloging files' }
  sendProgress(win)

  for (const att of targetAttachments) {
    if (!att.original_path || isAlreadyIndexed(att.original_path)) {
      indexingProgress.processed++
      if (indexingProgress.processed % 100 === 0) sendProgress(win)
      continue
    }

    const ext = extname(att.filename || att.original_path || '')
    const fname = basename(att.filename || att.original_path || 'unknown')
    const classification = classifyFile(ext, att.mime_type)
    const available = existsSync(att.original_path) ? 1 : 0

    insertAttachment({
      filename: fname,
      original_path: att.original_path,
      stash_path: null,
      file_size: att.file_size,
      mime_type: att.mime_type,
      created_at: att.created_at,
      chat_name: att.chat_name,
      sender_handle: att.sender_handle,
      thumbnail_path: null,
      file_extension: ext,
      ...classification,
      ocr_text: null,
      metadata_only: 1,
      is_available: available,
      source: 'messages'
    })

    indexingProgress.processed++
    if (indexingProgress.processed % 100 === 0) {
      indexingProgress.currentFile = fname
      sendProgress(win)
    }
  }

  sendProgress(win)
  if (win && !win.isDestroyed()) win.webContents.send('new-attachment-indexed')

  // ── Phase 2-5: Enrichment (thumbnails + OCR for available files) ──
  const toEnrich = targetAttachments.filter((a) => {
    if (!a.original_path) return false
    return !!getMetadataOnlyByPath(a.original_path)
  })

  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const sixMonthsStr = sixMonthsAgo.toISOString()

  const documents: MessageAttachment[] = []
  const recentImages: MessageAttachment[] = []
  const olderImages: MessageAttachment[] = []
  const videosAndAudio: MessageAttachment[] = []

  for (const att of toEnrich) {
    const ext = extname(att.filename || att.original_path || '').toLowerCase()
    const cls = classifyFile(ext, att.mime_type)
    if (cls.is_document) documents.push(att)
    else if (cls.is_image) {
      if (att.created_at && att.created_at >= sixMonthsStr) recentImages.push(att)
      else olderImages.push(att)
    } else if (cls.is_video || isAudio(ext, att.mime_type)) videosAndAudio.push(att)
  }

  const phases: { name: string; items: MessageAttachment[]; doOcr: boolean; doThumbnail: boolean }[] = [
    { name: 'Processing documents', items: documents, doOcr: false, doThumbnail: true },
    { name: 'Processing recent photos', items: recentImages, doOcr: true, doThumbnail: true },
    { name: 'Processing older photos', items: olderImages, doOcr: true, doThumbnail: true },
    { name: 'Processing videos & audio', items: videosAndAudio, doOcr: false, doThumbnail: true }
  ]

  const totalEnrich = documents.length + recentImages.length + olderImages.length + videosAndAudio.length
  let enrichProcessed = 0

  for (const phase of phases) {
    if (phase.items.length === 0) continue
    indexingProgress = { total: totalEnrich, processed: enrichProcessed, currentFile: '', phase: phase.name }
    sendProgress(win)

    for (const att of phase.items) {
      if (!att.original_path) { enrichProcessed++; indexingProgress.processed = enrichProcessed; sendProgress(win); continue }
      const id = getIdByPath(att.original_path)
      if (!id) { enrichProcessed++; indexingProgress.processed = enrichProcessed; sendProgress(win); continue }

      const ext = extname(att.filename || att.original_path || '')
      const fname = basename(att.filename || att.original_path || 'unknown')
      indexingProgress.currentFile = fname
      sendProgress(win)

      const fileExists = existsSync(att.original_path)
      updateAvailability(id, fileExists ? 1 : 0)

      if (fileExists) {
        if (phase.doThumbnail) {
          const thumbPath = await generateThumbnail(att.original_path, ext)
          if (thumbPath) updateThumbnail(id, thumbPath)
        }
        if (phase.doOcr) {
          const text = await runOcr(att.original_path)
          if (text) updateOcrText(id, text)
        }
      }

      markFullyIndexed(id)
      enrichProcessed++
      indexingProgress.processed = enrichProcessed
      if (enrichProcessed % 5 === 0) {
        sendProgress(win)
        if (win && !win.isDestroyed()) win.webContents.send('new-attachment-indexed')
      }
    }
  }

  // ── Phase 6: Orphaned file scan ──
  indexingProgress = { total: 1, processed: 0, currentFile: '', phase: 'Scanning for orphaned files' }
  sendProgress(win)

  const orphans = scanOrphanedFiles()
  if (orphans.length > 0) {
    indexingProgress.total = orphans.length
    for (const orphan of orphans) {
      const ext = extname(orphan.filename)
      const classification = classifyFile(ext, null)
      const id = insertAttachment({
        filename: orphan.filename,
        original_path: orphan.filePath,
        stash_path: null,
        file_size: orphan.fileSize,
        mime_type: null,
        created_at: orphan.mtime,
        chat_name: null,
        sender_handle: null,
        thumbnail_path: null,
        file_extension: ext,
        ...classification,
        ocr_text: null,
        metadata_only: 0,
        is_available: 1,
        source: 'orphan'
      })
      if (id && classification.is_image) {
        const thumb = await generateThumbnail(orphan.filePath, ext)
        if (thumb) updateThumbnail(id, thumb)
      }
      indexingProgress.processed++
      if (indexingProgress.processed % 10 === 0) sendProgress(win)
    }
  }

  isIndexing = false
  const finalTotal = Math.max(totalEnrich, targetAttachments.length, 1)
  indexingProgress = { total: finalTotal, processed: finalTotal, currentFile: '', phase: 'Up to date' }
  sendProgress(win)
  if (win && !win.isDestroyed()) win.webContents.send('new-attachment-indexed')

  // Watch for new attachments (also handles iCloud downloads arriving)
  const attachmentsDir = join(homedir(), 'Library/Messages/Attachments')
  if (existsSync(attachmentsDir)) {
    const watcher = watch(attachmentsDir, { ignoreInitial: true, persistent: true, depth: 10 })
    watcher.on('add', async (filePath) => {
      // Check if this file was previously indexed as unavailable
      const existingId = getIdByPath(filePath)
      if (existingId) {
        updateAvailability(existingId, 1)
        const ext = extname(filePath)
        const thumb = await generateThumbnail(filePath, ext)
        if (thumb) updateThumbnail(existingId, thumb)
        const att = getAttachmentById(existingId)
        if (att?.is_image) {
          const text = await runOcr(filePath)
          if (text) updateOcrText(existingId, text)
        }
        if (win && !win.isDestroyed()) win.webContents.send('new-attachment-indexed')
        return
      }

      const allAtts = readAllAttachments()
      const match = allAtts.find((a) => a.original_path === filePath)
      if (!match) return

      const ext = extname(filePath)
      const fname = basename(filePath)
      const classification = classifyFile(ext, match.mime_type)
      const thumbnailPath = await generateThumbnail(filePath, ext)

      const id = insertAttachment({
        filename: fname, original_path: filePath, stash_path: null,
        file_size: match.file_size, mime_type: match.mime_type, created_at: match.created_at,
        chat_name: match.chat_name, sender_handle: match.sender_handle,
        thumbnail_path: thumbnailPath, file_extension: ext, ...classification,
        ocr_text: null, metadata_only: 0, is_available: 1, source: 'messages'
      })

      if (id && classification.is_image) {
        runOcr(filePath).then((text) => { if (text) updateOcrText(id, text) })
      }
      if (win && !win.isDestroyed()) win.webContents.send('new-attachment-indexed')
    })
  }
}

export function getIndexingProgress(): typeof indexingProgress { return { ...indexingProgress } }
export function isCurrentlyIndexing(): boolean { return isIndexing }
