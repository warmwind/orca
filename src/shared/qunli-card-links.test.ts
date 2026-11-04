import { describe, expect, it } from 'vitest'
import { qunliCardLinks } from './qunli-card-links'

describe('Qunli cards associated with a PR', () => {
  it('uses title task ids for the Jinshuju team and ignores incidental ids in prose', () => {
    expect(qunliCardLinks('T18033 feat: add notes', ['Previously discussed T18015'])).toEqual([
      { identifier: 'T18033', url: 'https://qunli.co/2025/T18033' }
    ])
    expect(qunliCardLinks('Feature', ['Previously discussed T18015'])).toEqual([])
  })
  it('deduplicates descriptions, comments, title ids, fragments and tracking parameters', () => {
    expect(
      qunliCardLinks('T18033 feature', [
        'Task: [Notes](https://qunli.co/2025/T18033?source=pr#comment)',
        'https://qunli.co/2025/T18033。 Related: https://qunli.co/2025/T18015'
      ])
    ).toEqual([
      { identifier: 'T18033', url: 'https://qunli.co/2025/T18033' },
      { identifier: 'T18015', url: 'https://qunli.co/2025/T18015' }
    ])
  })
  it('preserves the account from explicit links instead of inventing a duplicate in the default team', () => {
    expect(qunliCardLinks('T18033 / T18015', ['https://qunli.co/other-team/T18033'])).toEqual([
      { identifier: 'T18033', url: 'https://qunli.co/other-team/T18033' },
      { identifier: 'T18015', url: 'https://qunli.co/other-team/T18015' }
    ])
  })
  it('does not guess an account when a PR links multiple teams', () => {
    const links = qunliCardLinks('T99 feature', ['https://qunli.co/one/T1 https://qunli.co/two/T2'])
    expect(links.map((card) => card.identifier)).toEqual(['T1', 'T2'])
  })
  it('supports project task routes while excluding project and document links', () => {
    expect(
      qunliCardLinks('Feature', [
        'https://qunli.co/2025/projects/44/tasks/T18033 https://qunli.co/2025/projects/44/tasks/record-uuid https://qunli.co/2025/projects/44/documents/12'
      ])
    ).toEqual([
      { identifier: 'T18033', url: 'https://qunli.co/2025/T18033' },
      { identifier: null, url: 'https://qunli.co/2025/projects/44/tasks/record-uuid' }
    ])
  })
  it('rejects credentialed links, lookalike domains, non-web schemes and partial task ids', () => {
    expect(
      qunliCardLinks('notT18033 nor T18033suffix nor T0', [
        'https://qunli.co.evil.example/2025/T18033',
        'https://secret@qunli.co/2025/T18033',
        'javascript:qunli.co/2025/T18033',
        'https://qunli.co:8443/2025/T18033'
      ])
    ).toEqual([])
  })
})
