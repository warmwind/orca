import { ipcRenderer } from 'electron'
import type { HostedReviewForBranchArgs } from '../../shared/hosted-review'
import type { PreloadApi } from '../api-types'

export const hostedReviewApi = {
  giteaDetails: (args: unknown) => ipcRenderer.invoke('hostedReview:giteaDetails', args),
  forBranch: (args: HostedReviewForBranchArgs) =>
    ipcRenderer.invoke('hostedReview:forBranch', args),
  getCreationEligibility: (args: unknown) =>
    ipcRenderer.invoke('hostedReview:getCreationEligibility', args),
  create: (args: unknown) => ipcRenderer.invoke('hostedReview:create', args),
  createStacked: (args: unknown) => ipcRenderer.invoke('hostedReview:createStacked', args)
} satisfies PreloadApi['hostedReview']
