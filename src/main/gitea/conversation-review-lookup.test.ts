import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lookupGiteaConversationReview } from './conversation-review-lookup'

const root = 'https://git.example.com'
function pull(number = 7) {
  return {
    number,
    title: 'Feature',
    html_url: `${root}/jiri/jiri/pulls/${number}`,
    state: 'open',
    head: { ref: 'feature', sha: 'abcd456full' }
  }
}
beforeEach(() => {
  vi.stubEnv('ORCA_GITEA_API_BASE_URL', root)
  vi.stubEnv('ORCA_GITEA_TOKEN', 'test-token')
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('cross-repository Gitea conversation lookup', () => {
  it('keeps a self-hosted installation subpath in both API calls and review URLs', async () => {
    vi.stubEnv('ORCA_GITEA_API_BASE_URL', `${root}/gitea`)
    const paths: string[] = []
    vi.stubGlobal('fetch', async (input: URL) => {
      paths.push(input.pathname)
      return Response.json(input.pathname.endsWith('/status') ? { state: 'success' } : pull())
    })
    expect(
      await lookupGiteaConversationReview({ url: `${root}/gitea/jiri/jiri/pulls/7` }, [])
    ).toMatchObject({ url: `${root}/gitea/jiri/jiri/pulls/7` })
    expect(paths[0]).toBe('/gitea/api/v1/repos/jiri/jiri/pulls/7')
  })
  it('does not associate an old push with a different PR that reused the branch', async () => {
    vi.stubGlobal('fetch', async () => Response.json([pull()]))
    expect(
      await lookupGiteaConversationReview(
        { remoteUrl: 'git@git.example.com:jiri/jiri.git', branch: 'feature', headSha: '7654321' },
        []
      )
    ).toBeNull()
  })
  it('reads exact PRs in different repositories and their check states', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', async (input: URL, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'token test-token' })
      expect(init.redirect).toBe('error')
      paths.push(input.pathname)
      return Response.json(input.pathname.endsWith('/status') ? { state: 'success' } : pull())
    })
    for (const repository of ['jiri/jiri', 'jiri/nextfe']) {
      const review = await lookupGiteaConversationReview(
        { url: `${root}/${repository}/pulls/7` },
        []
      )
      expect(review).toMatchObject({
        title: 'Feature',
        url: `${root}/${repository}/pulls/7`,
        status: 'success',
        checksAvailable: true
      })
    }
    expect(paths).toEqual([
      '/api/v1/repos/jiri/jiri/pulls/7',
      '/api/v1/repos/jiri/jiri/commits/abcd456full/status',
      '/api/v1/repos/jiri/nextfe/pulls/7',
      '/api/v1/repos/jiri/nextfe/commits/abcd456full/status'
    ])
  })
  it('never sends credentials to a foreign origin or an origin with URL credentials', async () => {
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls++
      return Response.json(pull())
    })
    expect(
      await lookupGiteaConversationReview({ url: 'https://foreign.example/jiri/jiri/pulls/7' }, [])
    ).toBeNull()
    await expect(
      lookupGiteaConversationReview(
        { url: 'https://user:secret@git.example.com/jiri/jiri/pulls/7' },
        []
      )
    ).rejects.toThrow('credentials')
    expect(calls).toBe(0)
  })
  it('can derive its trusted API origin from a registered remote', async () => {
    vi.stubEnv('ORCA_GITEA_API_BASE_URL', '')
    vi.stubGlobal('fetch', async (input: URL) =>
      Response.json(input.pathname.endsWith('/status') ? { state: 'pending' } : pull())
    )
    const review = await lookupGiteaConversationReview({ repository: 'jiri/nextfe', number: 7 }, [
      'git@git.example.com:jiri/jiri.git'
    ])
    expect(review).toMatchObject({ url: `${root}/jiri/nextfe/pulls/7`, status: 'pending' })
  })
  it('finds an existing open PR after a successful push', async () => {
    vi.stubGlobal('fetch', async (input: URL) =>
      Response.json(input.pathname.endsWith('/status') ? { state: 'failure' } : [pull()])
    )
    expect(
      await lookupGiteaConversationReview(
        { remoteUrl: 'git@git.example.com:jiri/jiri.git', branch: 'feature', headSha: 'abcd456' },
        []
      )
    ).toMatchObject({ number: 7, status: 'failure' })
  })
  it('distinguishes unavailable check data from no checks', async () => {
    vi.stubGlobal('fetch', async (input: URL) =>
      input.pathname.endsWith('/status')
        ? new Response(null, { status: 403 })
        : Response.json(pull())
    )
    expect(
      await lookupGiteaConversationReview({ url: `${root}/jiri/jiri/pulls/7` }, [])
    ).toMatchObject({ title: 'Feature', checksAvailable: false })
  })
  it('surfaces authentication failures instead of claiming there is no PR', async () => {
    vi.stubGlobal('fetch', async () => new Response(null, { status: 401 }))
    await expect(
      lookupGiteaConversationReview({ url: `${root}/jiri/jiri/pulls/7` }, [])
    ).rejects.toThrow('HTTP 401')
  })
})
