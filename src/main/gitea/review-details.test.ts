import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { readGiteaReviewDetailsForRepo, readGiteaReviewDetailsForUrl } from './review-details'

const repo: Repo = {
  id: 'repo',
  path: '/repo',
  displayName: 'jiri',
  badgeColor: 'gray',
  addedAt: 0,
  gitRemoteIdentity: {
    canonicalKey: 'git.example.com/jiri/jiri',
    remoteName: 'origin',
    remoteUrl: 'git@git.example.com:jiri/jiri.git'
  }
}
const pull = {
  number: 7,
  title: 'Feature',
  body: 'PR description',
  state: 'open',
  html_url: 'https://git.example.com/jiri/jiri/pulls/7',
  head: { sha: 'abc1234' }
}
const review = {
  id: 9,
  user: { login: 'reviewer' },
  body: 'Please fix this',
  state: 'REQUEST_CHANGES',
  comments_count: 1
}
function response(path: string) {
  if (path.endsWith('/pulls/7')) {
    return Response.json(pull)
  }
  if (path.includes('/commits/')) {
    return Response.json({
      state: 'failure',
      total_count: 3,
      statuses: [
        {
          context: 'lint',
          status: 'failure',
          description: 'Lint failed',
          target_url: 'https://ci.example/job/1'
        },
        { context: 'unit', status: 'success' },
        { context: 'review', status: 'pending' }
      ]
    })
  }
  if (path.endsWith('/reviews')) {
    return Response.json([review])
  }
  if (path.endsWith('/reviews/9/comments')) {
    return Response.json([
      {
        id: 4,
        user: { login: 'bot', type: 'bot' },
        body: 'Inline fix',
        path: 'src/main.ts',
        position: 12,
        commit_id: 'abc1234',
        diff_hunk: '@@ -1 +1 @@',
        resolver: null
      }
    ])
  }
  if (path.endsWith('/issues/7/comments')) {
    return Response.json([
      {
        id: 4,
        user: { login: 'human' },
        body: 'Conversation',
        html_url: 'https://git.example.com/jiri/jiri/pulls/7#issuecomment-4'
      }
    ])
  }
  return new Response(null, { status: 501 })
}
beforeEach(() => {
  vi.stubEnv('ORCA_GITEA_TOKEN', 'test-token')
  vi.stubEnv('ORCA_GITEA_API_BASE_URL', 'https://git.example.com')
  vi.stubGlobal('fetch', async (url: URL) => response(url.pathname))
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
describe('Gitea review details', () => {
  it('reads a conversation PR from another repository without a registered checkout', async () => {
    const requested: string[] = []
    vi.stubGlobal('fetch', async (url: URL) => {
      requested.push(url.pathname)
      return response(url.pathname)
    })
    const details = await readGiteaReviewDetailsForUrl(
      'https://git.example.com/other/nextfe/pulls/7',
      []
    )
    expect(details.review.url).toBe('https://git.example.com/other/nextfe/pulls/7')
    expect(requested).toContain('/api/v1/repos/other/nextfe/pulls/7')
    expect(details.comments.some((comment) => comment.path === 'src/main.ts')).toBe(true)
  })
  it('rejects a foreign PR URL before sending credentials', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(
      readGiteaReviewDetailsForUrl('https://foreign.example/other/nextfe/pulls/7', [])
    ).rejects.toThrow('configured or registered')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('returns checks, review decisions, ordinary and inline comments without ID collisions', async () => {
    const details = await readGiteaReviewDetailsForRepo(repo, 7)
    expect(details.review).toMatchObject({
      provider: 'gitea',
      number: 7,
      status: 'failure',
      checksAvailable: true
    })
    expect(details.checks.map((item) => [item.name, item.status, item.conclusion])).toEqual([
      ['lint', 'completed', 'failure'],
      ['unit', 'completed', 'success'],
      ['review', 'in_progress', null]
    ])
    expect(details.checkDescriptions.lint).toBe('Lint failed')
    expect(details.reviews[0]).toMatchObject({
      author: 'reviewer',
      state: 'REQUEST_CHANGES',
      body: 'Please fix this'
    })
    expect(details.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 4, author: 'human', body: 'Conversation' }),
        expect.objectContaining({
          id: -4,
          author: 'bot',
          path: 'src/main.ts',
          line: 12,
          isBot: true,
          isResolved: false,
          isOutdated: false
        })
      ])
    )
    expect(details.unavailable).toEqual([])
  })
  it('retains available data when review or check permissions are missing', async () => {
    vi.stubGlobal('fetch', async (url: URL) =>
      url.pathname.endsWith('/reviews') || url.pathname.includes('/commits/')
        ? new Response(null, { status: 403 })
        : response(url.pathname)
    )
    const details = await readGiteaReviewDetailsForRepo(repo, 7)
    expect(details.review.title).toBe('Feature')
    expect(details.review.checksAvailable).toBe(false)
    expect(details.unavailable).toEqual(expect.arrayContaining(['checks', 'reviews']))
    expect(details.comments).toHaveLength(1)
  })
  it('reports failed inline reads while retaining review decisions and ordinary comments', async () => {
    vi.stubGlobal('fetch', async (url: URL) =>
      url.pathname.endsWith('/reviews/9/comments')
        ? new Response(null, { status: 500 })
        : response(url.pathname)
    )
    const details = await readGiteaReviewDetailsForRepo(repo, 7)
    expect(details.unavailable).toContain('inline-comments')
    expect(details.reviews).toHaveLength(1)
    expect(details.comments[0].body).toBe('Conversation')
  })
  it('reads every review page before loading its inline comments', async () => {
    const pages: string[] = []
    vi.stubGlobal('fetch', async (url: URL) => {
      if (url.pathname.endsWith('/reviews')) {
        pages.push(url.searchParams.get('page') ?? '')
        return Response.json(
          url.searchParams.get('page') === '1'
            ? Array.from({ length: 50 }, (_, index) => ({ id: index + 100, comments_count: 0 }))
            : [review]
        )
      }
      return response(url.pathname)
    })
    const details = await readGiteaReviewDetailsForRepo(repo, 7)
    expect(pages).toEqual(['1', '2'])
    expect(details.reviews).toHaveLength(51)
    expect(details.comments.some((comment) => comment.path === 'src/main.ts')).toBe(true)
    expect(details.truncated).toBe(false)
  })
  it('refuses an unrelated PR response or an unregistered provider identity', async () => {
    vi.stubGlobal('fetch', async () => Response.json({ ...pull, number: 8 }))
    await expect(readGiteaReviewDetailsForRepo(repo, 7)).rejects.toThrow('different PR')
    await expect(
      readGiteaReviewDetailsForRepo({ ...repo, gitRemoteIdentity: null }, 7)
    ).rejects.toThrow('registered Gitea')
  })
})
