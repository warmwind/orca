import { useMemo } from 'react'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { NativeChatMessage } from '../../../../shared/native-chat/native-chat-types'
import type {
  NativeChatResolvedViewProps,
  NativeChatStructuredViewProps
} from './native-chat-view-types'
import type { useStructuredAgentSession } from './use-structured-agent-session'
import { useNativeChatFileLinkContext } from './use-native-chat-file-link-context'
import { createNativeChatRuntimeSelector } from './native-chat-runtime-owner'
import { useAppStore } from '@/store'
import { NativeChatRelatedReviews } from './NativeChatRelatedReviews'

const EMPTY_ITEMS: readonly never[] = []

export function NativeChatStructuredReviews({
  pane,
  journal
}: {
  pane: Omit<NativeChatStructuredViewProps, 'mode'>
  journal: Pick<ReturnType<typeof useStructuredAgentSession>, 'epoch' | 'journalItems'>
}): React.JSX.Element {
  const directory = useNativeChatFileLinkContext(pane.tabId)?.worktreePath
  return (
    <NativeChatRelatedReviews
      key={`${JSON.stringify(pane.target)}:${pane.sessionId}:${journal.epoch}`}
      sessionId={pane.sessionId}
      target={pane.target}
      items={journal.journalItems}
      directory={directory}
      isVisible={pane.isVisible && pane.isFocusedGroup}
    />
  )
}

export function NativeChatTranscriptReviews({
  pane,
  messages
}: {
  pane: NativeChatResolvedViewProps
  messages: readonly NativeChatMessage[]
}): React.JSX.Element {
  const selector = useMemo(
    () => createNativeChatRuntimeSelector(pane.terminalTabId),
    [pane.terminalTabId]
  )
  const environmentId = useAppStore(selector)
  const target = useMemo<RuntimeClientTarget>(
    () => (environmentId ? { kind: 'environment', environmentId } : { kind: 'local' }),
    [environmentId]
  )
  const directory = useNativeChatFileLinkContext(pane.terminalTabId)?.worktreePath
  return (
    <NativeChatRelatedReviews
      key={JSON.stringify([target, pane.agent, pane.sessionId, pane.transcriptPath])}
      sessionId={pane.sessionId ?? ''}
      target={target}
      items={EMPTY_ITEMS}
      transcript={{ agent: pane.agent, transcriptPath: pane.transcriptPath, messages }}
      isVisible={pane.isVisible && pane.isFocusedGroup}
      directory={directory}
    />
  )
}
