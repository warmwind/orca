import { defineFixture } from '../../../component-fixtures/component-fixture'
import { makeWorktree } from '../../worktree-jump/worktree-jump-palette-test-fixtures'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import { GiteaReviewPanel } from './gitea-review-panel'

const worktree = makeWorktree('gitea-fixture', 'Gitea feature')
const data: GiteaReviewDetails = {
  review: {
    provider: 'gitea',
    number: 172,
    title: 'Support Excel functions, text and choice variables',
    state: 'open',
    status: 'failure',
    checksAvailable: true,
    url: 'https://git.example.com/team/project/pulls/172',
    mergeable: 'MERGEABLE',
    headSha: 'abc1234',
    updatedAt: '2026-11-03T08:00:00Z'
  },
  description: 'Add formula support for the next release.',
  reviews: [
    {
      id: 1,
      author: 'reviewer',
      avatarUrl: '',
      state: 'REQUEST_CHANGES',
      body: 'Please address the inline feedback before merging.',
      url: 'https://git.example.com/team/project/pulls/172#review-1',
      submittedAt: '2026-11-03T07:00:00Z',
      dismissed: false,
      stale: false
    }
  ],
  comments: [
    {
      id: 2,
      author: 'teammate',
      authorAvatarUrl: '',
      body: 'The updated behavior looks good.',
      createdAt: '2026-11-03T07:30:00Z',
      url: ''
    },
    {
      id: -3,
      author: 'review_bot',
      authorAvatarUrl: '',
      isBot: true,
      body: 'Move this lookup outside the loop to avoid repeated database queries.',
      path: 'app/services/form_time_formula.rb',
      line: 10,
      threadId: 'gitea-comment:3',
      isResolved: false,
      isOutdated: false,
      createdAt: '2026-11-03T07:15:00Z',
      url: ''
    }
  ],
  checks: [
    { name: 'Claude review', status: 'completed', conclusion: 'failure', url: null },
    { name: 'PR CI: unit tests', status: 'completed', conclusion: 'success', url: null },
    { name: 'PR CI: coverage', status: 'in_progress', conclusion: null, url: null }
  ],
  checkDescriptions: { 'Claude review': 'There are unresolved review comments.' },
  unavailable: [],
  truncated: false
}
const state = { data, loading: false, error: null, refresh: () => {} }
export const narrow = defineFixture({
  width: 360,
  render: () => <GiteaReviewPanel worktree={worktree} review={data.review} state={state} />
})
export const qunliCards = defineFixture({
  width: 360,
  render: () => {
    const linked = {
      ...data,
      review: { ...data.review, title: 'T18033 Support routine run notes' },
      description: 'Task: https://qunli.co/2025/T18033. Related: https://qunli.co/2025/T18015'
    }
    return <GiteaReviewPanel review={linked.review} state={{ ...state, data: linked }} />
  }
})
export const wide = defineFixture({
  width: 640,
  render: () => <GiteaReviewPanel worktree={worktree} review={data.review} state={state} />
})
export const partial = defineFixture({
  width: 360,
  render: () => (
    <GiteaReviewPanel
      worktree={worktree}
      review={data.review}
      state={{
        ...state,
        data: { ...data, checks: [], reviews: [], unavailable: ['checks', 'reviews'] }
      }}
    />
  )
})
