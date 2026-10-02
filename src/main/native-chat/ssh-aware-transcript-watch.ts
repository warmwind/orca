import { agentHookServer } from '../agent-hooks/server'
import {
  getSshFilesystemProvider,
  SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE
} from '../providers/ssh-filesystem-dispatch'
import { findSshTranscriptOwner } from './ssh-transcript-owner'
import { isMissingRemoteFileError, readSshTranscriptTail } from './ssh-transcript-reader'
import { subscribeSshNativeChatTranscript } from './ssh-transcript-subscription'
import {
  readNativeChatTranscriptTail as readLocalNativeChatTranscriptTail,
  subscribeNativeChatTranscript as subscribeLocalNativeChatTranscript,
  type NativeChatTranscriptSubscription,
  type SubscribeNativeChatTranscriptArgs
} from './transcript-watch'

export type { NativeChatTranscriptSubscription, SubscribeNativeChatTranscriptArgs }

// Why: an SSH agent writes its transcript on the remote host; the desktop's own
// disk never has it, so those sessions are read through the SSH connection.
// Same signatures as transcript-watch so callers only swap the import.
function sshOwnerFor(args: { sessionId: string; transcriptPath?: string }) {
  return findSshTranscriptOwner(agentHookServer.getStatusSnapshot(), args)
}

export async function readNativeChatTranscriptTail(
  args: Parameters<typeof readLocalNativeChatTranscriptTail>[0],
  signal?: AbortSignal
): ReturnType<typeof readLocalNativeChatTranscriptTail> {
  const owner = sshOwnerFor(args)
  if (!owner) {
    return readLocalNativeChatTranscriptTail(args, signal)
  }
  const provider = getSshFilesystemProvider(owner.connectionId)
  if (!provider) {
    return { error: SSH_FILESYSTEM_PROVIDER_UNAVAILABLE_MESSAGE }
  }
  try {
    const page = await readSshTranscriptTail({
      provider,
      filePath: owner.transcriptPath,
      agent: args.agent,
      limit: args.limit,
      beforeOffset: args.beforeOffset
    })
    return {
      messages: page.messages,
      ...(page.lifecycle ? { lifecycle: page.lifecycle } : {}),
      hasMore: page.hasMore,
      beforeOffset: page.beforeOffset
    }
  } catch (error) {
    return isMissingRemoteFileError(error)
      ? { error: 'Transcript unavailable', notFound: true }
      : { error: error instanceof Error ? error.message : String(error) }
  }
}

export async function subscribeNativeChatTranscript(
  args: SubscribeNativeChatTranscriptArgs,
  setupSignal?: AbortSignal
): Promise<NativeChatTranscriptSubscription> {
  const owner = sshOwnerFor(args)
  return owner
    ? subscribeSshNativeChatTranscript(args, owner)
    : subscribeLocalNativeChatTranscript(args, setupSignal)
}
