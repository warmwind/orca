import type { AgentJournalToolCallItem } from './agent-session/journal/agent-session-journal-types'
import { nativeChatFullCommand } from './native-chat/tools/native-chat-tool-input-text'
import { normalizeToolInput } from './native-chat/tools/native-chat-tool-summary'
import {
  conversationReviewUrls as reviewUrls,
  readConversationReviewOutput
} from './conversation-review-output'
import { parseWorkspaceReferenceUrl } from './workspace-attachments/workspace-reference-identity'
import { isRuntimePathAbsolute } from './cross-platform-path'
import {
  conversationReviewCreationReceipts,
  conversationReviewCurlRequest
} from './conversation-review-creation-receipts'

export type ConversationReviewLookup =
  | { url: string }
  | { remoteUrl: string; branch: string; headSha: string }
  | { repository: string; number: number }
  | { directory: string; number: number }

export type ConversationReviewMutation = {
  action: 'created' | 'updated'
  lookup: ConversationReviewLookup
}

function commandInputs(input: unknown): string[] {
  const command = nativeChatFullCommand(input)
  if (command && !command.includes('tools.exec_command(')) {
    return [command]
  }
  const normalized = normalizeToolInput(input)
  const code =
    typeof normalized === 'string'
      ? normalized
      : normalized && typeof normalized === 'object' && 'code' in normalized
        ? normalized.code
        : null
  if (typeof code !== 'string') {
    return []
  }
  if (!/^\s*(?:text\(|(?:const|let)\s+\w+\s*=\s*)?await\s+tools\.exec_command\(/.test(code)) {
    return []
  }
  // Only literal exec_command arguments; dynamic scripts need an explicit PR URL receipt.
  return Array.from(
    code.matchAll(/\btools\.exec_command\(\{[^{}]*?\bcmd:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)
  ).flatMap((match) => {
    try {
      const literal = match[1]
      const decoded: unknown = literal.startsWith('"') ? JSON.parse(literal) : literal.slice(1, -1)
      return typeof decoded === 'string' ? [decoded] : []
    } catch {
      return []
    }
  })
}

function staticCommandWords(command: string): string[] | null {
  const words: string[] = []
  let word = ''
  let quote: string | null = null
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (char === quote) {
      quote = null
      continue
    }
    if (!quote && (char === "'" || char === '"')) {
      quote = char
      continue
    }
    if (char === '\\' && quote !== "'" && /[\s"'\\]/.test(command[index + 1] ?? '')) {
      word += command[++index]
      continue
    }
    if (quote !== "'" && (char === '`' || (char === '$' && command[index + 1] === '('))) {
      return null
    }
    if (!quote && /[;&|<>]/.test(char)) {
      return null
    }
    if (!quote && /\s/.test(char)) {
      if (char === '\n' && command.slice(index).trim()) {
        return null
      }
      if (word) {
        words.push(word)
        word = ''
      }
    } else {
      word += char
    }
  }
  if (quote) {
    return null
  }
  if (word) {
    words.push(word)
  }
  return words
}

/** Successful write tools are evidence; prose, read tools and failed attempts are not. */
export function conversationReviewMutations(
  tool: AgentJournalToolCallItem,
  defaultDirectory?: string
): ConversationReviewMutation[] {
  if (
    tool.state !== 'completed' ||
    tool.endedAs ||
    (tool.exitCode !== undefined && tool.exitCode !== 0) ||
    !tool.output
  ) {
    return []
  }
  const result = readConversationReviewOutput(tool.output.head)
  const output = result.text
  if (
    result.failed ||
    /(?:exit(?:ed)?(?: with)?(?: code|_code)?["\s:]+|Process exited with code\s+)[1-9]\d*|\[rejected\]|(?:^|\n)\s*(?:error|fatal):/i.test(
      output
    )
  ) {
    return []
  }
  const commands = commandInputs(tool.input)
  const mutations: ConversationReviewMutation[] = commands.flatMap((command) =>
    conversationReviewCreationReceipts({ command }, result.urls, staticCommandWords).map((url) => ({
      action: 'created',
      lookup: { url }
    }))
  )
  const input = normalizeToolInput(tool.input)
  const fields =
    input && typeof input === 'object' ? Object.fromEntries(Object.entries(input)) : null
  const directory =
    typeof fields?.workdir === 'string'
      ? fields.workdir
      : typeof fields?.cwd === 'string'
        ? fields.cwd
        : defaultDirectory
  for (const rawCommand of commands) {
    const changedDirectory = /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*&&\s*/.exec(rawCommand)
    const command = rawCommand.replace(/^\s*cd\s+(?:"[^"]+"|'[^']+'|[^\s;&|]+)\s*&&\s*/, '')
    const argv = staticCommandWords(command)
    if (!argv || argv.includes('--help') || argv.includes('-h')) {
      continue
    }
    const cli = argv[0]
      ?.replace(/\\/g, '/')
      .split('/')
      .at(-1)
      ?.replace(/\.exe$/i, '')
      .toLowerCase()
    const group = argv[1]
    const aliases: Record<string, string> = {
      c: 'create',
      e: 'edit',
      m: 'merge',
      open: 'reopen',
      a: 'approve',
      lgtm: 'approve',
      reply: 'comment'
    }
    const verb = cli === 'tea' ? (aliases[argv[2]] ?? argv[2]) : argv[2]
    const isReviewCli =
      (cli === 'gh' && group === 'pr') ||
      (cli === 'glab' && group === 'mr') ||
      (cli === 'tea' && ['pr', 'pull', 'pulls'].includes(group))
    if (
      isReviewCli &&
      [
        'create',
        'edit',
        'merge',
        'close',
        'reopen',
        'ready',
        'comment',
        'approve',
        'reject',
        'resolve',
        'unresolve'
      ].includes(verb)
    ) {
      const action = verb === 'create' ? 'created' : 'updated'
      const target = argv[3] ?? ''
      const targetNumber = /^\d+$/.test(target) ? Number(target) : null
      const targetUrls = reviewUrls(target)
      const outputUrls = result.urls.filter(
        (url) => targetNumber === null || parseWorkspaceReferenceUrl(url).number === targetNumber
      )
      const urls = action === 'created' ? outputUrls : targetUrls.length ? targetUrls : outputUrls
      if (urls.length === 1) {
        mutations.push({ action, lookup: { url: urls[0] } })
      } else if (
        urls.length === 0 &&
        cli === 'tea' &&
        targetNumber !== null &&
        Number.isSafeInteger(targetNumber) &&
        targetNumber > 0 &&
        !argv.some(
          (word) => word === '--login' || word.startsWith('--login=') || word.startsWith('-l')
        )
      ) {
        const repoFlag = argv.findIndex(
          (word) => word === '--repo' || word.startsWith('--repo=') || word.startsWith('-r')
        )
        const repository =
          repoFlag === -1
            ? null
            : argv[repoFlag].startsWith('--repo=')
              ? argv[repoFlag].slice(7)
              : argv[repoFlag].startsWith('-r') && argv[repoFlag].length > 2
                ? argv[repoFlag].slice(2)
                : argv[repoFlag + 1]
        if (repository && /^[\w.-]+\/[\w.-]+$/.test(repository)) {
          mutations.push({ action, lookup: { repository, number: targetNumber } })
        } else if (repoFlag === -1) {
          const cwd = changedDirectory?.[1].replace(/^['"]|['"]$/g, '') ?? directory
          const opaqueDirectory =
            fields && typeof fields.code === 'string' && /\b(?:workdir|cwd)\s*:/.test(fields.code)
          if (cwd && isRuntimePathAbsolute(cwd) && !opaqueDirectory) {
            mutations.push({ action, lookup: { directory: cwd, number: targetNumber } })
          }
        }
      }
    }
    if (cli === 'curl') {
      const request = conversationReviewCurlRequest(argv)
      if (request && ['POST', 'PATCH', 'PUT'].includes(request.method)) {
        const targets = request.urls.flatMap(reviewUrls).filter((url) => result.urls.includes(url))
        if (targets.length === 1) {
          mutations.push({ action: 'updated', lookup: { url: targets[0] } })
        }
      }
    }
    const push = cli === 'git' && (argv[1] === 'push' || (argv[1] === '-C' && argv[3] === 'push'))
    if (push && !argv.includes('--dry-run') && !argv.includes('-n')) {
      const remoteUrl = /(?:^|\n)To (\S+)/.exec(output)?.[1]
      if (remoteUrl) {
        for (const match of output.matchAll(
          /^\s*(?:\+\s+)?[\da-f]+\.{2,3}([\da-f]{7,64})\s+\S+\s+->\s+(\S+)/gm
        )) {
          mutations.push({
            action: 'updated',
            lookup: { remoteUrl, branch: match[2], headSha: match[1] }
          })
        }
      }
    }
  }

  const toolName = tool.mcpIdentity?.tool ?? tool.name
  if (/^(?:mcp__[^\s]+__)?(?:create|update|edit)_pull_request$/.test(toolName)) {
    const urls = result.urls
    if (urls.length === 1 && !/(?:"isError"\s*:\s*true|"ok"\s*:\s*false)/.test(output)) {
      mutations.push({
        action: toolName.endsWith('create_pull_request') ? 'created' : 'updated',
        lookup: { url: urls[0] }
      })
    }
  }
  return [...new Map(mutations.map((mutation) => [JSON.stringify(mutation), mutation])).values()]
}
