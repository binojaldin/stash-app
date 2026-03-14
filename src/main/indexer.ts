import { BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'fs'
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
  getIdByPath
} from './db'
import { compileOcrHelper, runOcr } from './ocr'
import { compileContactsHelper, resolveContact } from './contacts'
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
  if (lExt === '.heic') return null

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

function getPrefsPath(): string {
  return join(app.getPath('appData'), 'Stash', 'prefs.json')
}

function loadPriorityChats(): string[] | null {
  const prefsPath = getPrefsPath()
  if (!existsSync(prefsPath)) return null
  try {
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'))
    return prefs.priorityChats ?? null
  } catch {
    return null
  }
}

function savePriorityChats(chats: string[]): void {
  const prefsPath = getPrefsPath()
  let prefs: Record<string, unknown> = {}
  if (existsSync(prefsPath)) {
    try {
      prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'))
    } catch { /* ignore */ }
  }
  prefs.priorityChats = chats
  writeFileSync(prefsPath, JSON.stringify(prefs, null, 2))
}

export interface ResolvedChatSummary {
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
  // If there's already a proper display name (not a phone/email/chat ID), use it
  if (summary.display_name && !summary.display_name.startsWith('+') && !summary.display_name.includes('@') && !isGroupChatIdentifier(summary.display_name)) {
    return summary.display_name
  }

  // For group chats, resolve participant handles
  if (isGroupChatIdentifier(summary.raw_chat_identifier) && summary.participant_handles.length > 0) {
    const names = summary.participant_handles.slice(0, 4).map((h) => resolveContact(h))
    const label = names.join(', ')
    if (summary.participant_handles.length > 4) {
      return `Group: ${label} +${summary.participant_handles.length - 4}`
    }
    return `Group: ${label}`
  }

  // Single chat — resolve the chat_identifier as a handle
  const identifier = summary.raw_chat_identifier || summary.chat_name
  if (identifier && (identifier.startsWith('+') || identifier.includes('@'))) {
    return resolveContact(identifier)
  }

  return summary.chat_name
}

export function fetchChatSummaries(): ResolvedChatSummary[] {
  compileContactsHelper()
  const summaries = getChatSummaries()
  return summaries.map((s) => ({
    chat_name: s.chat_name,
    display_name: resolveDisplayName(s),
    raw_chat_identifier: s.raw_chat_identifier,
    attachment_count: s.attachment_count,
    last_message_date: s.last_message_date,
    participant_handles: s.participant_handles
  }))
}

export function saveChatPriorities(chats: string[]): void {
  savePriorityChats(chats)
}

export function getSavedPriorityChats(): string[] | null {
  return loadPriorityChats()
}

export async function startIndexing(win: BrowserWindow | null, priorityChats?: string[]): Promise<void> {
  if (isIndexing) return
  isIndexing = true

  initDb()
  compileOcrHelper()

  // Save priority chats if provided
  if (priorityChats) {
    savePriorityChats(priorityChats)
  }
  const savedPriority = priorityChats ?? loadPriorityChats() ?? []

  const allAttachments = readAllAttachments()

  // ── Phase 1: Metadata-only insert for ALL attachments ──
  indexingProgress = { total: allAttachments.length, processed: 0, currentFile: '', phase: 'Cataloging metadata' }
  sendProgress(win)

  for (const att of allAttachments) {
    if (!att.original_path || isAlreadyIndexed(att.original_path)) {
      indexingProgress.processed++
      if (indexingProgress.processed % 100 === 0) sendProgress(win)
      continue
    }

    const ext = extname(att.filename || att.original_path || '')
    const fname = basename(att.filename || att.original_path || 'unknown')
    const classification = classifyFile(ext, att.mime_type)

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
      metadata_only: 1
    })

    indexingProgress.processed++
    if (indexingProgress.processed % 100 === 0) {
      indexingProgress.currentFile = fname
      sendProgress(win)
    }
  }

  // Notify renderer that phase 1 is done — all records are searchable
  sendProgress(win)
  if (win && !win.isDestroyed()) {
    win.webContents.send('new-attachment-indexed')
  }

  // Collect items that still need enrichment (metadata_only=1)
  const toEnrich = allAttachments.filter((a) => {
    if (!a.original_path) return false
    const row = getMetadataOnlyByPath(a.original_path)
    return !!row
  })

  // Sort priority chats first
  const prioritySet = new Set(savedPriority)
  const sortByPriority = (a: MessageAttachment, b: MessageAttachment): number => {
    const aP = a.chat_name && prioritySet.has(a.chat_name) ? 0 : 1
    const bP = b.chat_name && prioritySet.has(b.chat_name) ? 0 : 1
    return aP - bP
  }

  // Classify into phases
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

    if (cls.is_document) {
      documents.push(att)
    } else if (cls.is_image) {
      if (att.created_at && att.created_at >= sixMonthsStr) {
        recentImages.push(att)
      } else {
        olderImages.push(att)
      }
    } else if (cls.is_video || isAudio(ext, att.mime_type)) {
      videosAndAudio.push(att)
    }
  }

  // Sort each group by priority chats
  documents.sort(sortByPriority)
  recentImages.sort(sortByPriority)
  olderImages.sort(sortByPriority)
  videosAndAudio.sort(sortByPriority)

  const phases: { name: string; items: MessageAttachment[]; doOcr: boolean; doThumbnail: boolean }[] = [
    { name: 'Documents', items: documents, doOcr: false, doThumbnail: true },
    { name: 'Recent images', items: recentImages, doOcr: true, doThumbnail: true },
    { name: 'Older images', items: olderImages, doOcr: true, doThumbnail: true },
    { name: 'Videos & audio', items: videosAndAudio, doOcr: false, doThumbnail: true }
  ]

  const totalEnrich = documents.length + recentImages.length + olderImages.length + videosAndAudio.length
  let enrichProcessed = 0

  for (const phase of phases) {
    if (phase.items.length === 0) continue

    indexingProgress = {
      total: totalEnrich,
      processed: enrichProcessed,
      currentFile: '',
      phase: phase.name
    }
    sendProgress(win)

    for (const att of phase.items) {
      if (!att.original_path) {
        enrichProcessed++
        indexingProgress.processed = enrichProcessed
        sendProgress(win)
        continue
      }

      const id = getIdByPath(att.original_path)
      if (!id) {
        enrichProcessed++
        indexingProgress.processed = enrichProcessed
        sendProgress(win)
        continue
      }

      const ext = extname(att.filename || att.original_path || '')
      const fname = basename(att.filename || att.original_path || 'unknown')
      indexingProgress.currentFile = fname
      sendProgress(win)

      // Generate thumbnail if file exists
      if (phase.doThumbnail && existsSync(att.original_path)) {
        const thumbPath = await generateThumbnail(att.original_path, ext)
        if (thumbPath) {
          updateThumbnail(id, thumbPath)
        }
      }

      // Run OCR for images
      if (phase.doOcr && existsSync(att.original_path)) {
        const text = await runOcr(att.original_path)
        if (text) {
          updateOcrText(id, text)
        }
      }

      markFullyIndexed(id)

      enrichProcessed++
      indexingProgress.processed = enrichProcessed
      if (enrichProcessed % 5 === 0) {
        sendProgress(win)
        if (win && !win.isDestroyed()) {
          win.webContents.send('new-attachment-indexed')
        }
      }
    }
  }

  isIndexing = false
  indexingProgress = { total: totalEnrich, processed: totalEnrich, currentFile: '', phase: 'Complete' }
  sendProgress(win)

  if (win && !win.isDestroyed()) {
    win.webContents.send('new-attachment-indexed')
  }

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
        ocr_text: null,
        metadata_only: 0
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
