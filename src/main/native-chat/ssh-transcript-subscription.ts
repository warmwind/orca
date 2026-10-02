import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-filesystem-dispatch'
import type {
  NativeChatTranscriptSubscription,
  SubscribeNativeChatTranscriptArgs
} from './transcript-watch-contract'
import type { SshTranscriptOwner } from './ssh-transcript-owner'
import {
  isMissingRemoteFileError,
  readSshTranscriptAppend,
  readSshTranscriptTail,
  type SshTranscriptCursor
} from './ssh-transcript-reader'

const ACTIVE_POLL_MS = 1_000
const IDLE_POLL_MS = 4_000
// Polls without new bytes before backing off to the idle interval.
const IDLE_AFTER_EMPTY_POLLS = 10

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Follow a transcript on the SSH host that wrote it. SFTP has no change
 * notification, so this polls the file size and reads only appended bytes.
 * A dropped connection keeps polling: the provider is re-resolved every tick
 * so a reconnect resumes without resubscribing.
 */
export function subscribeSshNativeChatTranscript(
  args: SubscribeNativeChatTranscriptArgs & { pollIntervalMs?: number },
  owner: SshTranscriptOwner
): NativeChatTranscriptSubscription {
  const activePollMs = args.pollIntervalMs ?? ACTIVE_POLL_MS
  const idlePollMs = args.pollIntervalMs ?? IDLE_POLL_MS
  const limit = args.initialLimit ?? 40
  let closed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let cursor: SshTranscriptCursor | null = null
  let emptyPolls = 0
  let pendingReported = false
  let lastError: string | null = null

  function schedule(): void {
    if (closed) {
      return
    }
    timer = setTimeout(
      () => {
        timer = null
        void tick()
      },
      emptyPolls >= IDLE_AFTER_EMPTY_POLLS ? idlePollMs : activePollMs
    )
    timer.unref?.()
  }

  function reportError(message: string): void {
    // Only the first frame of a failure streak; repeating it would spam clients every tick.
    if (lastError === message || cursor !== null) {
      return
    }
    lastError = message
    args.onInitialSnapshot?.([], false, 0, message)
  }

  async function readInitial(): Promise<void> {
    const provider = getSshFilesystemProvider(owner.connectionId)
    if (!provider) {
      reportError(SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE)
      return
    }
    try {
      const page = await readSshTranscriptTail({
        provider,
        filePath: owner.transcriptPath,
        agent: args.agent,
        limit
      })
      if (closed) {
        return
      }
      cursor = page.cursor
      args.onInitialSnapshot?.(
        page.messages,
        page.hasMore,
        page.beforeOffset,
        undefined,
        page.lifecycle
      )
    } catch (error) {
      if (isMissingRemoteFileError(error)) {
        // Same as a local session whose agent has not flushed its first record yet.
        if (!pendingReported && args.onTranscriptPending) {
          pendingReported = true
          args.onTranscriptPending()
        }
        return
      }
      reportError(errorMessage(error))
    }
  }

  async function readAppended(current: SshTranscriptCursor): Promise<void> {
    const provider = getSshFilesystemProvider(owner.connectionId)
    if (!provider) {
      return
    }
    try {
      const appended = await readSshTranscriptAppend({
        provider,
        filePath: owner.transcriptPath,
        agent: args.agent,
        cursor: current
      })
      if (closed) {
        return
      }
      if (!appended) {
        await replace()
        return
      }
      if (appended.cursor === current) {
        emptyPolls++
        return
      }
      emptyPolls = 0
      cursor = appended.cursor
      if (appended.messages.length > 0 || appended.lifecycle) {
        args.onAppend(appended.messages, appended.lifecycle)
      }
    } catch {
      // Transient SSH failures retry on the next tick; the shown history stays valid.
    }
  }

  async function replace(): Promise<void> {
    const provider = getSshFilesystemProvider(owner.connectionId)
    if (!provider) {
      return
    }
    const page = await readSshTranscriptTail({
      provider,
      filePath: owner.transcriptPath,
      agent: args.agent,
      limit
    })
    if (closed) {
      return
    }
    cursor = page.cursor
    emptyPolls = 0
    if (args.onReplace) {
      args.onReplace(page.messages, page.hasMore, page.beforeOffset, page.lifecycle)
      return
    }
    args.onInitialSnapshot?.(
      page.messages,
      page.hasMore,
      page.beforeOffset,
      undefined,
      page.lifecycle
    )
  }

  async function tick(): Promise<void> {
    if (closed) {
      return
    }
    await (cursor === null ? readInitial() : readAppended(cursor))
    schedule()
  }

  void tick()

  return {
    watching: true,
    unsubscribe: () => {
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
  }
}
