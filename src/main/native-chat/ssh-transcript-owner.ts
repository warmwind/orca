import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import { isWslHookRelayConnectionId } from '../../shared/wsl-hook-relay-contract'

export type SshTranscriptOwner = {
  connectionId: string
  transcriptPath: string
}

/** The SSH connection whose hook reported this provider session, with the
 *  transcript path that host attested. Null when the best match is a local or
 *  WSL session, which the desktop reads from its own disk. */
export function findSshTranscriptOwner(
  rows: readonly AgentStatusIpcPayload[],
  request: { sessionId: string; transcriptPath?: string }
): SshTranscriptOwner | null {
  const requestedPath = request.transcriptPath?.trim()
  // Rank across every host first: a resumed session can exist both locally and
  // over SSH, and an id-plus-path match must beat an id-only one.
  let best: { row: AgentStatusIpcPayload; score: number } | null = null
  for (const row of rows) {
    const session = row.providerSession
    if (!session) {
      continue
    }
    const idMatches = session.id === request.sessionId
    const pathMatches = requestedPath !== undefined && session.transcriptPath === requestedPath
    const score = (idMatches ? 1 : 0) + (pathMatches ? 2 : 0)
    if (
      score > 0 &&
      (!best ||
        score > best.score ||
        (score === best.score && row.receivedAt > best.row.receivedAt))
    ) {
      best = { row, score }
    }
  }
  const connectionId = best?.row.connectionId
  if (!best || !connectionId || isWslHookRelayConnectionId(connectionId)) {
    return null
  }
  const transcriptPath = best.row.providerSession?.transcriptPath?.trim() || requestedPath
  return transcriptPath ? { connectionId, transcriptPath } : null
}
