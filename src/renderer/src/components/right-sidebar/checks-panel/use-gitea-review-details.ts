import { useCallback, useEffect, useState } from 'react'
import type { Repo } from '../../../../../shared/repo-types'
import type { GiteaReviewDetails } from '../../../../../shared/gitea-review-details'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import {
  getRepoExecutionHostId,
  toRuntimeExecutionHostId
} from '../../../../../shared/execution-host'
import { loadGiteaReviewDetails } from '@/runtime/gitea-review-client'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { checksPanelLoadErrorMessage } from './checks-panel-forge-owner'

export function useGiteaReviewDetails(repo: Repo, number: number, visible: boolean, revision = '') {
  const hostId = getRepoExecutionHostId(repo)
  const key = JSON.stringify([
    hostId,
    repo.id,
    repo.path,
    number,
    repo.gitRemoteIdentity?.canonicalKey
  ])
  const load = useCallback(() => loadGiteaReviewDetails(repo, number), [repo, number])
  return useGiteaReviewRead(key, hostId, load, visible, revision)
}

export function useGiteaReviewUrlDetails(
  target: RuntimeClientTarget,
  url: string,
  visible: boolean
) {
  const environmentId = target.kind === 'environment' ? target.environmentId : null
  const hostId = environmentId ? toRuntimeExecutionHostId(environmentId) : 'local'
  const key = JSON.stringify([hostId, url])
  const load = useCallback(
    () =>
      callRuntimeRpc<GiteaReviewDetails>(
        environmentId ? { kind: 'environment', environmentId } : { kind: 'local' },
        'hostedReview.giteaDetails',
        { url },
        { timeoutMs: 60_000 }
      ),
    [environmentId, url]
  )
  return useGiteaReviewRead(key, hostId, load, visible)
}

function useGiteaReviewRead(
  key: string,
  hostId: string,
  load: () => Promise<GiteaReviewDetails>,
  visible: boolean,
  revision = ''
) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    key: string
    data: GiteaReviewDetails | null
    error: string | null
    loading: boolean
  }>({ key, data: null, error: null, loading: false })
  useEffect(() => {
    if (!visible) {
      return
    }
    let current = true
    setState((prior) => ({
      key,
      data: prior.key === key ? prior.data : null,
      error: null,
      loading: true
    }))
    void load().then(
      (data) => {
        if (current) {
          setState({ key, data, error: null, loading: false })
        }
      },
      (error: unknown) => {
        if (current) {
          setState((prior) => ({
            key,
            data: prior.key === key ? prior.data : null,
            error: checksPanelLoadErrorMessage(error, hostId),
            loading: false
          }))
        }
      }
    )
    return () => {
      current = false
    }
  }, [key, hostId, load, visible, attempt, revision])
  return {
    ...(state.key === key ? state : { key, data: null, error: null, loading: visible }),
    refresh: useCallback(() => setAttempt((value) => value + 1), [])
  }
}
