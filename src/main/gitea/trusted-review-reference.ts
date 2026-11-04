import { getAuthConfig } from './client'
import { parseGiteaRepoRef } from './repository-ref'
import { parseWorkspaceReferenceUrl } from '../../shared/workspace-attachments/workspace-reference-identity'

export function trustedGiteaWebBases(trustedRemotes: readonly string[]): string[] {
  const configured = getAuthConfig().apiBaseUrl
  return configured
    ? [new URL(configured).href.replace(/\/$/, '').replace(/\/api\/v1$/i, '')]
    : [
        ...new Set(
          trustedRemotes.flatMap((remote) => {
            const repo = parseGiteaRepoRef(remote)
            return repo ? [repo.webBaseUrl] : []
          })
        )
      ]
}

export function trustedGiteaReviewReference(url: string, trustedRemotes: readonly string[]) {
  const reference = parseWorkspaceReferenceUrl(url)
  if (
    reference.provider !== 'gitea' ||
    reference.type !== 'pr' ||
    !reference.url ||
    !reference.number
  ) {
    return null
  }
  const repo = parseGiteaRepoRef(reference.url.replace(/\/pulls\/\d+$/, ''))
  return repo && trustedGiteaWebBases(trustedRemotes).includes(repo.webBaseUrl)
    ? { repo, number: reference.number }
    : null
}
