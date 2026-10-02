import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import { wslHookRelayConnectionId } from '../../shared/wsl-hook-relay-contract'
import { findSshTranscriptOwner } from './ssh-transcript-owner'

function row(overrides: Partial<AgentStatusIpcPayload>): AgentStatusIpcPayload {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the owner lookup reads only connectionId, providerSession and receivedAt.
  return {
    paneKey: 'tab-1:pane-1',
    connectionId: null,
    receivedAt: 1,
    ...overrides
  } as AgentStatusIpcPayload
}

const remotePath = '/home/dev/.claude/projects/-home-dev-app/s1.jsonl'

describe('findSshTranscriptOwner', () => {
  it('routes a session reported over SSH to that connection and its attested path', () => {
    const owner = findSshTranscriptOwner(
      [
        row({
          connectionId: 'ssh-hermes',
          providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
        })
      ],
      { sessionId: 's1' }
    )
    expect(owner).toEqual({ connectionId: 'ssh-hermes', transcriptPath: remotePath })
  })

  it('leaves local and WSL sessions on the local reader', () => {
    const rows = [
      row({ providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath } }),
      row({
        connectionId: wslHookRelayConnectionId('Ubuntu'),
        providerSession: { key: 'session_id', id: 's2', transcriptPath: remotePath }
      })
    ]
    expect(findSshTranscriptOwner(rows, { sessionId: 's1' })).toBeNull()
    expect(findSshTranscriptOwner(rows, { sessionId: 's2' })).toBeNull()
  })

  it('matches by transcript path when the hook session id differs', () => {
    const owner = findSshTranscriptOwner(
      [
        row({
          connectionId: 'ssh-hermes',
          providerSession: { key: 'session_id', id: 'hook-id', transcriptPath: remotePath }
        })
      ],
      { sessionId: 'file-id', transcriptPath: remotePath }
    )
    expect(owner?.connectionId).toBe('ssh-hermes')
  })

  it('prefers the newest report for a session', () => {
    const owner = findSshTranscriptOwner(
      [
        row({
          connectionId: 'ssh-old',
          receivedAt: 1,
          providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
        }),
        row({
          connectionId: 'ssh-new',
          receivedAt: 2,
          providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
        })
      ],
      { sessionId: 's1' }
    )
    expect(owner?.connectionId).toBe('ssh-new')
  })

  it('keeps a local session that matches id and path over an SSH id-only match', () => {
    const owner = findSshTranscriptOwner(
      [
        row({
          connectionId: 'ssh-hermes',
          receivedAt: 5,
          providerSession: { key: 'session_id', id: 's1', transcriptPath: remotePath }
        }),
        row({
          receivedAt: 1,
          providerSession: { key: 'session_id', id: 's1', transcriptPath: '/Users/me/s1.jsonl' }
        })
      ],
      { sessionId: 's1', transcriptPath: '/Users/me/s1.jsonl' }
    )
    expect(owner).toBeNull()
  })
})
