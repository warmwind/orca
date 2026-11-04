import { ExternalLink } from 'lucide-react'
import { qunliCardLinks } from '../../../../../shared/qunli-card-links'
import { openAppHttpLinkFromAnchor } from '@/lib/app-http-link-open'
import { translate } from '@/i18n/i18n'

export function QunliCardLinks(props: {
  title: string
  texts: readonly string[]
  worktreeId?: string
}): React.JSX.Element | null {
  const cards = qunliCardLinks(props.title, props.texts)
  if (!cards.length) {
    return null
  }
  const label = translate('gitea.review.qunliCards', 'Qunli cards')
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 text-xs"
      aria-label={label}
      data-qunli-card-links=""
    >
      <span className="text-muted-foreground">{label}</span>
      {cards.map((card) => (
        <a
          key={card.url}
          href={card.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-foreground underline-offset-2 hover:bg-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={(event) => openAppHttpLinkFromAnchor(event, props.worktreeId)}
        >
          {card.identifier ?? translate('gitea.review.qunliCard', 'Open card')}
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      ))}
    </div>
  )
}
