import type {
  AgentType,
  NativeChatMessage,
  NativeChatTurnLifecycle
} from '../../shared/native-chat-types'
import { isENOENT } from '../ipc/filesystem-path-containment'
import type { IFilesystemProvider } from '../providers/filesystem-provider-contract'
import {
  readRemoteTranscriptRange,
  supportsRemoteTranscriptRangeRead
} from '../runtime/orchestration/worker-transcript-remote-range-read'
import { sshFileStreamReadCap } from '../ssh/ssh-file-stream-read-cap'
import { transcriptFallbackId } from './transcript-fallback-id'
import {
  MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES,
  nativeChatLineDecoderForAgent
} from './transcript-tail-reader'
import { nativeChatTurnLifecycleDecoderForAgent } from './transcript-turn-lifecycle'

// Relay errors lose Node's string code; isENOENT also matches the forwarded message.
export const isMissingRemoteFileError = isENOENT

const INITIAL_SCAN_BYTES = 512 * 1024
const MAX_SCAN_BYTES = 8 * 1024 * 1024
// Bytes before the follow offset compared on every poll to detect a rewritten file.
const CHECKPOINT_BYTES = 256

/** Where to resume following a transcript, and the bytes that must still precede it. */
export type SshTranscriptCursor = {
  offset: number
  checkpoint: string
  /** The cursor sits inside an oversized record being skipped. */
  insideRecord: boolean
}

export type SshTranscriptPage = {
  messages: NativeChatMessage[]
  lifecycle?: NativeChatTurnLifecycle
  hasMore: boolean
  beforeOffset: number
  cursor: SshTranscriptCursor
}

type DecodedRecord = { message: NativeChatMessage; offset: number }

type DecodedRange = {
  records: DecodedRecord[]
  lifecycle?: NativeChatTurnLifecycle
  firstRecordStart: number
  consumedTo: number
}

/** Tail of a transcript that lives on an SSH host, windowed like the local tail
 *  reader: the newest `limit` messages before `beforeOffset` (or EOF). */
export async function readSshTranscriptTail(args: {
  provider: IFilesystemProvider
  filePath: string
  agent: AgentType
  limit: number
  beforeOffset?: number
}): Promise<SshTranscriptPage> {
  const size = (await args.provider.stat(args.filePath)).size
  const end = Math.min(size, args.beforeOffset ?? size)
  let scanBytes = INITIAL_SCAN_BYTES
  for (;;) {
    const start = Math.max(0, end - scanBytes)
    const bytes = await readRange(args.provider, args.filePath, start, end)
    const decoded = decodeRange(args, bytes, start, start > 0)
    const enough = decoded.records.length > args.limit
    if (enough || start === 0 || scanBytes >= MAX_SCAN_BYTES) {
      const selected = decoded.records.slice(-args.limit)
      // A record-free window still pages from a record boundary so no message is split.
      const firstOffset =
        selected[0]?.offset ?? (decoded.firstRecordStart < end ? decoded.firstRecordStart : start)
      const consumedTo = args.beforeOffset === undefined ? decoded.consumedTo : end
      return {
        messages: selected.map((record) => record.message),
        ...(args.beforeOffset === undefined && decoded.lifecycle
          ? { lifecycle: decoded.lifecycle }
          : {}),
        hasMore: firstOffset > 0 && (enough || start > 0),
        beforeOffset: firstOffset,
        cursor: {
          offset: consumedTo,
          checkpoint: await readCheckpoint(args.provider, args.filePath, consumedTo),
          insideRecord: false
        }
      }
    }
    scanBytes *= 4
  }
}

/** Complete records appended after `cursor`. Returns null when the bytes before
 *  the cursor changed (file rewritten, truncated or replaced), so the caller
 *  re-reads the tail. */
export async function readSshTranscriptAppend(args: {
  provider: IFilesystemProvider
  filePath: string
  agent: AgentType
  cursor: SshTranscriptCursor
}): Promise<{
  messages: NativeChatMessage[]
  lifecycle?: NativeChatTurnLifecycle
  cursor: SshTranscriptCursor
} | null> {
  const { offset } = args.cursor
  const size = (await args.provider.stat(args.filePath)).size
  if (
    size < offset ||
    (await readCheckpoint(args.provider, args.filePath, offset)) !== args.cursor.checkpoint
  ) {
    return null
  }
  if (size === offset) {
    return { messages: [], cursor: args.cursor }
  }
  const end = Math.min(size, offset + MAX_SCAN_BYTES)
  const bytes = await readRange(args.provider, args.filePath, offset, end)
  const decoded = decodeRange(args, bytes, offset, args.cursor.insideRecord)
  // A full window with no record end is one oversized record: skip past it
  // rather than re-reading the same bytes forever.
  const skipping =
    (decoded.consumedTo === offset && bytes.length === MAX_SCAN_BYTES) ||
    (args.cursor.insideRecord && !bytes.includes(0x0a))
  const nextOffset = skipping ? end : decoded.consumedTo
  return {
    messages: decoded.records.map((record) => record.message),
    ...(decoded.lifecycle ? { lifecycle: decoded.lifecycle } : {}),
    cursor:
      nextOffset === offset
        ? args.cursor
        : {
            offset: nextOffset,
            checkpoint: await readCheckpoint(args.provider, args.filePath, nextOffset),
            insideRecord: skipping
          }
  }
}

async function readCheckpoint(
  provider: IFilesystemProvider,
  filePath: string,
  offset: number
): Promise<string> {
  const bytes = await readRange(provider, filePath, Math.max(0, offset - CHECKPOINT_BYTES), offset)
  return bytes.toString('base64')
}

async function readRange(
  provider: IFilesystemProvider,
  filePath: string,
  start: number,
  end: number
): Promise<Buffer> {
  if (end <= start) {
    return Buffer.alloc(0)
  }
  if (await supportsRemoteTranscriptRangeRead(provider)) {
    return readRemoteTranscriptRange(provider, filePath, start, end - start)
  }
  // Why: relays without positional reads only serve whole files up to the SSH stream cap.
  const result = await provider.readFile(filePath, {
    maxTextBytes: sshFileStreamReadCap(false)
  })
  if (typeof result.content !== 'string') {
    throw new Error('Remote transcript read returned invalid content')
  }
  return Buffer.from(result.content, 'utf8').subarray(start, end)
}

function decodeRange(
  args: { filePath: string; agent: AgentType },
  bytes: Buffer,
  absoluteStart: number,
  skipLeadingPartial: boolean
): DecodedRange {
  const decode = nativeChatLineDecoderForAgent(args.agent)
  const decodeLifecycle = nativeChatTurnLifecycleDecoderForAgent(args.agent)
  const records: DecodedRecord[] = []
  let lifecycle: NativeChatTurnLifecycle | undefined
  let cursor = 0
  if (skipLeadingPartial) {
    const newline = bytes.indexOf(0x0a)
    cursor = newline === -1 ? bytes.length : newline + 1
  }
  const firstRecordStart = absoluteStart + cursor
  let consumed = cursor
  while (cursor < bytes.length) {
    const newline = bytes.indexOf(0x0a, cursor)
    // An unterminated record may still be mid-write; leave it for the next append read.
    if (newline === -1) {
      break
    }
    const lineBytes = bytes.subarray(cursor, newline)
    const lineOffset = absoluteStart + cursor
    cursor = newline + 1
    consumed = cursor
    if (lineBytes.length === 0 || lineBytes.length > MAX_NATIVE_CHAT_TRANSCRIPT_RECORD_BYTES) {
      continue
    }
    const line = lineBytes.toString('utf8').replace(/\r$/, '')
    try {
      JSON.parse(line)
    } catch {
      continue
    }
    const fallbackId = transcriptFallbackId(args.filePath, lineOffset)
    lifecycle = decodeLifecycle?.(line, fallbackId) ?? lifecycle
    const message = decode?.(line, fallbackId)
    if (message) {
      records.push({ message, offset: lineOffset })
    }
  }
  return { records, lifecycle, firstRecordStart, consumedTo: absoluteStart + consumed }
}
