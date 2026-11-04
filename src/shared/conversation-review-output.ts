import { stripAnsiEscapeSequences } from './ansi-escape-sequences'
import { parseWorkspaceReferenceUrl } from './workspace-reference-identity'

export function conversationReviewUrls(text: string): string[] {
  return [
    ...new Set(
      Array.from(text.matchAll(/https?:\/\/[^\s<>"'`]+/g)).flatMap(([candidate]) => {
        try {
          const url = new URL(candidate.replace(/[),.;\]}]+$/, ''))
          url.pathname = url.pathname.replace(
            /\/api\/v1\/repos\/(.+)\/pulls\/(\d+)(?:\/.*)?$/,
            '/$1/pulls/$2'
          )
          const reference = parseWorkspaceReferenceUrl(url.href)
          return reference.type !== 'issue' && reference.url ? [reference.url] : []
        } catch {
          return []
        }
      })
    )
  ]
}

function jsonBoundary(text: string, start: number): number | null {
  let depth = 0
  let quoted = false
  for (let index = start; index < text.length; index++) {
    const char = text[index]
    if (quoted && char === '\\') {
      index++
    } else if (char === '"') {
      quoted = !quoted
    } else if (!quoted) {
      if (char === '{' || char === '[') {
        depth++
      } else if (char === '}' || char === ']') {
        depth--
        if (depth === 0) {
          return index + 1
        }
      }
    }
  }
  return null
}

/** Read result identities and transport envelopes; PR bodies and error messages are not receipts. */
export function readConversationReviewOutput(output: string): {
  urls: string[]
  text: string
  failed: boolean
} {
  const urls: string[] = []
  const chunks: string[] = []
  let failed = false
  function plain(text: string): void {
    if (/^(?:error\b|fatal\b|unauthorized\b|forbidden\b|already exists\b)/im.test(text.trim())) {
      failed = true
    }
    chunks.push(text)
    urls.push(...conversationReviewUrls(text))
  }
  function value(result: unknown, depth: number): void {
    if (depth > 12) {
      return
    }
    if (typeof result === 'string') {
      content(result, depth + 1)
      return
    }
    if (Array.isArray(result)) {
      for (const entry of result) {
        value(entry, depth + 1)
      }
      return
    }
    if (!result || typeof result !== 'object') {
      return
    }
    const fields = Object.fromEntries(Object.entries(result))
    if (
      fields.isError === true ||
      fields.ok === false ||
      fields.error ||
      (Array.isArray(fields.errors) && fields.errors.length > 0) ||
      [fields.exit_code, fields.exitCode].some((code) => typeof code === 'number' && code !== 0) ||
      (typeof fields.status === 'number' && fields.status >= 400)
    ) {
      failed = true
      return
    }
    for (const candidate of [fields.html_url, fields.web_url, fields.url]) {
      if (typeof candidate !== 'string') {
        continue
      }
      const number = fields.number ?? fields.iid
      urls.push(
        ...conversationReviewUrls(candidate).filter(
          (url) => number === undefined || parseWorkspaceReferenceUrl(url).number === number
        )
      )
    }
    for (const key of ['output', 'stdout', 'stderr', 'result', 'content', 'structuredContent']) {
      if (fields[key] !== undefined) {
        value(fields[key], depth + 1)
      }
    }
    if (fields.type === 'text' && typeof fields.text === 'string') {
      content(fields.text, depth + 1)
    }
  }
  function content(raw: string, depth: number): void {
    const text = stripAnsiEscapeSequences(raw)
    try {
      value(JSON.parse(text), depth + 1)
      return
    } catch {
      // Shell output may combine structured results with ordinary log lines.
    }
    let cursor = 0
    for (let index = 0; index < text.length; index++) {
      if (text[index] !== '{' && text[index] !== '[') {
        continue
      }
      const end = jsonBoundary(text, index)
      if (end === null) {
        if (/^\{\s*"/.test(text.slice(index))) {
          plain(text.slice(cursor, index))
          return
        }
        continue
      }
      try {
        const parsed: unknown = JSON.parse(text.slice(index, end))
        plain(text.slice(cursor, index))
        value(parsed, depth + 1)
        cursor = end
        index = end - 1
      } catch {
        continue
      }
    }
    plain(text.slice(cursor))
  }
  content(output, 0)
  return { urls: [...new Set(urls)], text: chunks.join('\n'), failed }
}
