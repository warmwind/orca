import type { AgentJournalToolCallItem } from './agent-session/journal/agent-session-journal-types'
import { normalizeToolInput } from './native-chat/tools/native-chat-tool-summary'
import { parseWorkspaceReferenceUrl } from './workspace-reference-identity'

export type ConversationQunliCardLinks = Record<string, string[]>

export function mergeConversationQunliCardLinks(
  ...sources: readonly ConversationQunliCardLinks[]
): ConversationQunliCardLinks {
  const result: ConversationQunliCardLinks = {}
  for (const source of sources) {
    for (const [review, cards] of Object.entries(source)) {
      result[review] = [...new Set([...(result[review] ?? []), ...cards])]
    }
  }
  return result
}

/** A successful Qunli card write can explicitly link an existing PR to that card. */
export function conversationQunliCardLinks(
  tools: readonly AgentJournalToolCallItem[]
): ConversationQunliCardLinks {
  const result: ConversationQunliCardLinks = {}
  for (const tool of tools) {
    const identity = tool.mcpIdentity
    const qunli =
      /^mcp__\S*qunli\S*__(add_comment|update_task)$/i.test(tool.name) ||
      (identity &&
        /qunli/i.test(identity.server) &&
        /^(add_comment|update_task)$/.test(identity.tool))
    if (
      !qunli ||
      !tool.output ||
      tool.state !== 'completed' ||
      tool.endedAs ||
      (tool.exitCode !== undefined && tool.exitCode !== 0) ||
      /"(?:isError|is_error)"\s*:\s*true|"(?:ok|success)"\s*:\s*false/.test(tool.output?.head ?? '')
    ) {
      continue
    }
    const input = normalizeToolInput(tool.input)
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      continue
    }
    const fields: Record<string, unknown> = Object.fromEntries(Object.entries(input))
    const account = String(fields.account_id ?? '')
    const task = String(fields.recording_id ?? fields.task_id ?? '')
    if (!/^[\w-]+$/.test(account) || !/^T[1-9]\d*$/i.test(task)) {
      continue
    }
    const card = `https://qunli.co/${account}/${task.toUpperCase()}`
    const text = [fields.text, fields.content_html, fields.description]
      .filter((value) => typeof value === 'string')
      .join('\n')
    for (const [url] of text.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
      try {
        const reference = parseWorkspaceReferenceUrl(url.replace(/[),.;\]}，。；）]+$/, ''))
        if ((reference.type === 'pr' || reference.type === 'mr') && reference.url) {
          result[reference.url] = [...new Set([...(result[reference.url] ?? []), card])]
        }
      } catch {
        continue
      }
    }
  }
  return result
}
