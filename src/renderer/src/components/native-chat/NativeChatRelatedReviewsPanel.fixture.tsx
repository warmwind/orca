import { defineFixture } from '../../component-fixtures/component-fixture'
import { NativeChatRelatedReviewsPanel } from './NativeChatRelatedReviewsPanel'
import type { ConversationReviewRow } from './use-conversation-reviews'

const rows: ConversationReviewRow[] = ['jiri', 'nextfe', 'goldendata'].map((repo, index) => {
  const url = `https://git.example.com/jiri/${repo}/pulls/42`
  return {
    sequence: index,
    operationKey: String(index),
    key: url,
    lookup: { url },
    action: index ? 'updated' : 'created',
    loading: false,
    review: {
      provider: 'gitea',
      number: 42,
      title: [
        'Support private Gitea pull requests',
        'Refresh related PR status across repositories',
        'Preserve unavailable check results'
      ][index],
      state: index === 2 ? 'merged' : index === 1 ? 'closed' : 'open',
      status: index === 1 ? 'pending' : 'success',
      checksAvailable: index !== 2,
      url,
      mergeable: 'UNKNOWN',
      updatedAt: '2026-11-03'
    }
  }
})
const props = {
  expanded: true,
  loadingHistory: false,
  error: false,
  onToggle: () => {},
  onRefresh: () => {}
}
export const crossRepository = defineFixture({
  width: 760,
  render: () => <NativeChatRelatedReviewsPanel {...props} rows={rows} />
})
export const narrow = defineFixture({
  width: 360,
  render: () => (
    <NativeChatRelatedReviewsPanel
      {...props}
      rows={rows}
      onSelectReview={() => {}}
      selectedKey={rows[0].key}
    />
  )
})
export const unavailable = defineFixture({
  width: 360,
  render: () => (
    <NativeChatRelatedReviewsPanel {...props} rows={[{ ...rows[0], review: null }]} error />
  )
})
