export type QunliCardLink = { url: string; identifier: string | null }

type QunliCardReference = QunliCardLink & { account: string }

function parseCardUrl(candidate: string): QunliCardReference | null {
  try {
    const url = new URL(candidate.replace(/[),.;:!?\]}，。；：！？）]+$/, ''))
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !['qunli.co', 'www.qunli.co'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null
    }
    const route = /^\/([\w-]+)\/(T[1-9]\d*|projects\/[\w-]+\/tasks\/[\w-]+)\/?$/i.exec(url.pathname)
    if (!route) {
      return null
    }
    const task = route[2].split('/').at(-1)!
    const identifier = /^T[1-9]\d*$/i.test(task) ? task.toUpperCase() : null
    const path = identifier ? `/${route[1]}/${identifier}` : url.pathname.replace(/\/$/, '')
    return { account: route[1], identifier, url: `https://qunli.co${path}` }
  } catch {
    return null
  }
}

/** Complete card URLs take precedence over title-only task identifiers. */
export function qunliCardLinks(
  title: string,
  texts: readonly string[],
  defaultAccount = '2025'
): QunliCardLink[] {
  const links = new Map<string, QunliCardReference>()
  for (const text of [title, ...texts]) {
    for (const [candidate] of text.matchAll(/https?:\/\/[^\s<>"'`，。；、]+/gi)) {
      const card = parseCardUrl(candidate)
      if (card) {
        links.set(card.url, card)
      }
    }
  }
  const accounts = new Set([...links.values()].map((card) => card.account))
  const account =
    accounts.size === 1 ? [...accounts][0] : accounts.size === 0 ? defaultAccount : null
  if (account && /^[\w-]+$/.test(account)) {
    for (const [task] of title.matchAll(/\bT[1-9]\d*\b/gi)) {
      const identifier = task.toUpperCase()
      if ([...links.values()].some((card) => card.identifier === identifier)) {
        continue
      }
      const url = `https://qunli.co/${account}/${identifier}`
      links.set(url, { account, identifier, url })
    }
  }
  return [...links.values()].map(({ url, identifier }) => ({ url, identifier }))
}
