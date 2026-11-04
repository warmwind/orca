import { describe, expect, it } from 'vitest'
import type { AgentJournalToolCallItem } from './agent-session/journal/agent-session-journal-types'
import { conversationQunliCardLinks } from './conversation-qunli-card-links'

const url = 'https://git.example.com/jiri/jiri/pulls/349'
function write(overrides: Partial<AgentJournalToolCallItem> = {}): AgentJournalToolCallItem {
  return {
    kind: 'tool-call',
    name: 'mcp__claude_ai_Qunli__add_comment',
    state: 'completed',
    input: { account_id: '2025', recording_id: 'T18033', text: `PR: ${url}` },
    output: { head: '{"ok":true}', byteLength: 11, digest: '', truncated: false },
    ...overrides
  }
}
describe('conversation Qunli card associations', () => {
  it('finds an explicit card-to-PR link even when the PR title has no task id', () => {
    expect(conversationQunliCardLinks([write(), write()])).toEqual({
      [url]: ['https://qunli.co/2025/T18033']
    })
  })
  it('keeps multiple cards and teams separate for the same PR', () => {
    expect(
      conversationQunliCardLinks([
        write(),
        write({
          input: { account_id: 'other', task_id: 'T9', description: `See ${url}` },
          name: 'mcp__qunli__update_task'
        })
      ])[url]
    ).toEqual(['https://qunli.co/2025/T18033', 'https://qunli.co/other/T9'])
  })
  it.each([
    { state: 'failed' as const },
    { state: 'running' as const },
    { output: undefined },
    { name: 'mcp__qunli__get_task' },
    { name: 'Bash' },
    { endedAs: 'interrupted' as const },
    { output: { head: '{"isError":true}', byteLength: 16, digest: '', truncated: false } }
  ])('ignores reads and unconfirmed writes: %j', (overrides) => {
    expect(conversationQunliCardLinks([write(overrides)])).toEqual({})
  })
})
