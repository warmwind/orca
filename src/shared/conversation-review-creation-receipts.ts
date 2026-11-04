import { nativeChatFullCommand } from './native-chat/tools/native-chat-tool-input-text'

export function reviewCreationEndpointMatches(endpoint: string, receipt: string): boolean {
  try {
    const api = new URL(endpoint)
    const page = new URL(receipt)
    return (
      api.origin === page.origin &&
      page.pathname.replace(/\/\d+$/, '') ===
        api.pathname.replace('/api/v1/repos/', '/').replace(/\/$/, '')
    )
  } catch {
    return false
  }
}

export function conversationReviewCurlRequest(argv: readonly string[]): {
  method: string
  urls: string[]
} | null {
  if (
    argv[0]
      ?.replace(/\\/g, '/')
      .split('/')
      .at(-1)
      ?.replace(/\.exe$/i, '') !== 'curl' ||
    argv.includes('--next')
  ) {
    return null
  }
  const urls: string[] = []
  let method: string | undefined
  let data = false
  for (let index = 1; index < argv.length; index++) {
    const word = argv[index]
    if (word === '-X' || word === '--request') {
      method = argv[++index]
    } else if (word.startsWith('-X') || word.startsWith('--request=')) {
      method = word.replace(/^(?:-X|--request=)/, '')
    } else if (word === '--url') {
      urls.push(argv[++index] ?? '')
    } else if (word.startsWith('--url=')) {
      urls.push(word.slice(6))
    } else if (
      /^(?:-[dF].*|--(?:data(?:-raw|-binary|-urlencode|-ascii)?|json|form(?:-string)?)(?:=|$))/.test(
        word
      )
    ) {
      data = true
      if (/^(?:-[dF]|--[\w-]+)$/.test(word)) {
        index++
      }
    } else if (
      /^(?:-[HuoAebcKxT]|--(?:header|user|output|user-agent|referer|cookie|cookie-jar|config|proxy|upload-file|oauth2-bearer|connect-to|resolve))$/.test(
        word
      )
    ) {
      index++
    } else if (/^https?:\/\//.test(word)) {
      urls.push(word)
    }
  }
  const read = argv.some((word) => ['-G', '--get', '-I', '--head'].includes(word))
  return { method: method?.toUpperCase() ?? (data && !read ? 'POST' : 'GET'), urls }
}

/** Literal shell command segments; substitutions remain opaque argument text. */
function shellCommandSegments(shell: string): string[] {
  const segments: string[] = []
  let segment = ''
  let quote = ''
  for (let index = 0; index < shell.length; index++) {
    const char = shell[index]
    if (char === '\\' && quote !== "'") {
      const next = shell[++index]
      if (next !== '\n') {
        segment += `\\${next ?? ''}`
      }
      continue
    }
    if (char === quote) {
      quote = ''
    } else if (!quote && (char === "'" || char === '"')) {
      quote = char
    } else if (quote !== "'" && (char === '`' || (char === '$' && shell[index + 1] === '('))) {
      const backtick = char === '`'
      let depth = 1
      let innerQuote = ''
      if (!backtick) {
        index++
      }
      while (++index < shell.length && depth) {
        const inner = shell[index]
        if (inner === '\\' && innerQuote !== "'") {
          index++
        } else if (backtick) {
          if (inner === '`') {
            depth = 0
          }
        } else if (inner === innerQuote) {
          innerQuote = ''
        } else if (!innerQuote && (inner === "'" || inner === '"')) {
          innerQuote = inner
        } else if (!innerQuote && inner === '(') {
          depth++
        } else if (!innerQuote && inner === ')') {
          depth--
        }
      }
      if (depth) {
        return []
      }
      index--
      segment += '__dynamic_shell_argument__'
      continue
    } else if (!quote && char === '#' && (!segment || /\s$/.test(segment))) {
      while (index + 1 < shell.length && shell[index + 1] !== '\n') {
        index++
      }
      continue
    } else if (!quote && /[;|&\n]/.test(char)) {
      if (segment.trim()) {
        segments.push(segment.trim())
      }
      segment = ''
      continue
    }
    segment += char
  }
  if (quote) {
    return []
  }
  if (segment.trim()) {
    segments.push(segment.trim())
  }
  return segments
}

/** Match normalized result identities to the repository that received the create request. */
export function conversationReviewCreationReceipts(
  input: unknown,
  receipts: readonly string[],
  parseCommand: (command: string) => string[] | null
): string[] {
  const command = nativeChatFullCommand(input)
  if (!command) {
    return []
  }
  if (!receipts.length) {
    return []
  }
  const lines = command.split('\n')
  const shell: string[] = []
  const scripts: string[] = []
  for (let index = 0; index < lines.length; index++) {
    const header = lines[index]
    const marker = /<<(-?)\s*(?:'([\w]+)'|"([\w]+)"|([\w]+))/.exec(header)
    if (!marker) {
      shell.push(header)
      continue
    }
    const delimiter = marker[2] ?? marker[3] ?? marker[4]
    const body: string[] = []
    while (
      ++index < lines.length &&
      lines[index].replace(marker[1] ? /^\t*/ : /^$/, '') !== delimiter
    ) {
      body.push(lines[index])
    }
    if (index === lines.length) {
      return []
    }
    const file = /^\s*cat\s*>\s*(\/[\w./-]+\.py)\s*<</.exec(header)?.[1]
    const executed =
      file && lines.slice(index + 1).some((line) => line.trim() === `python3 ${file}`)
    if (/^\s*python3?(?:\s+-)?\s*<</.test(header) || executed) {
      scripts.push(body.join('\n'))
    }
  }
  const endpoints: string[] = []
  for (const segment of shellCommandSegments(shell.join('\n'))) {
    const argv = parseCommand(segment)
    const request = argv && conversationReviewCurlRequest(argv)
    if (request?.method === 'POST') {
      endpoints.push(
        ...request.urls.filter((word) =>
          /^https?:\/\/\S+\/api\/v1\/repos\/[^/?#]+\/[^/?#]+\/pulls\/?(?:\?|$)/.test(word)
        )
      )
    }
  }
  for (const script of scripts) {
    endpoints.push(
      ...Array.from(
        script.matchAll(
          /^\s*\w+\s*=\s*urllib\.request\.Request\(\s*(['"])(https?:\/\/[^'"\s]+\/api\/v1\/repos\/[^'"\s]+\/pulls)\1,[^\n]*\bmethod\s*=\s*['"]POST['"]/gm
        ),
        (match) => match[2]
      )
    )
  }
  return [
    ...new Set(
      endpoints.flatMap((endpoint) => {
        const matched = receipts.filter((receipt) =>
          reviewCreationEndpointMatches(endpoint, receipt)
        )
        return matched.length === 1 ? matched : []
      })
    )
  ]
}
