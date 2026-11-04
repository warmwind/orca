import { defineFixture } from '../../../component-fixtures/component-fixture'
import type { ConversationReviewScope } from '../../native-chat/conversation-review-scope'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import { ConversationReviewsSidebar } from './ConversationReviewsSidebar'

const scope: ConversationReviewScope = {
  key: 'cross-repository-conversation',
  sessionId: 'conversation',
  target: { kind: 'local' },
  loadingHistory: false,
  error: false,
  lookupError: false,
  refresh: () => {},
  rows: ['jiri', 'nextfe', 'goldendata'].map((name, index) => {
    const url = `https://git.example.com/team/${name}/pulls/7`
    return {
      key: url,
      sequence: index,
      operationKey: name,
      action: index === 0 ? 'created' : 'updated',
      lookup: { url },
      loading: false,
      review: {
        provider: 'gitea',
        number: 7,
        title: `${name}: support conversation pull requests`,
        url,
        state: 'open',
        status: index === 1 ? 'failure' : 'success',
        updatedAt: '',
        mergeable: 'MERGEABLE'
      }
    }
  })
}
function setup() {
  const original = window.api.runtime.call
  window.api.runtime.call = async (request) => {
    if (request.method !== 'hostedReview.giteaDetails') {
      return original(request)
    }
    const params = request.params
    if (
      !params ||
      typeof params !== 'object' ||
      !('url' in params) ||
      typeof params.url !== 'string'
    ) {
      throw new Error('Expected PR URL')
    }
    const row = scope.rows.find((row) => row.review?.url === params.url)
    if (!row?.review) {
      throw new Error('Unknown fixture PR')
    }
    const data: GiteaReviewDetails = {
      review: row.review,
      description: '',
      checks: [{ name: 'PR CI: review', status: 'completed', conclusion: 'failure', url: null }],
      checkDescriptions: { 'PR CI: review': 'One review needs attention.' },
      reviews: [
        {
          id: 1,
          author: 'reviewer',
          avatarUrl: '',
          state: 'REQUEST_CHANGES',
          body: 'Please address the feedback for this repository.',
          submittedAt: '',
          dismissed: false,
          stale: false,
          url: row.review.url
        }
      ],
      comments: [
        {
          id: 1,
          author: 'teammate',
          authorAvatarUrl: '',
          body: `Review feedback for ${new URL(row.review.url).pathname.split('/')[2]}.`,
          createdAt: '',
          url: row.review.url
        }
      ],
      unavailable: [],
      truncated: false
    }
    return { id: 'fixture', ok: true, result: data, _meta: { runtimeId: 'fixture' } }
  }
}
export const crossRepository = defineFixture({
  width: 360,
  setup,
  render: () => <ConversationReviewsSidebar scope={scope} visible />,
  interact: async (frame) => {
    frame.querySelector<HTMLAnchorElement>('a[href*="/nextfe/"]')?.click()
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  }
})
export const emptyConversation = defineFixture({
  width: 360,
  render: () => <ConversationReviewsSidebar scope={{ ...scope, rows: [] }} visible />
})
