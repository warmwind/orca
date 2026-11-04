import { z } from 'zod'
import { OptionalBoolean, requiredString } from './rpc-param-primitives'
import { OptionalGitAdmissionTier } from './git-admission-tier-params'

export const GiteaReviewDetails = z.union([
  z.object({ repo: requiredString('Missing repo selector'), number: z.number().int().positive() }),
  z.object({ url: z.string().url().max(2048) })
])

export const HostedReviewConversationLookup = z.union([
  z.object({ directory: z.string().min(1).max(4096), number: z.number().int().positive() }),
  z.object({ url: z.string().url().max(2048) }),
  z.object({
    remoteUrl: z.string().min(1).max(2048),
    branch: z.string().min(1).max(512),
    headSha: z.string().regex(/^[\da-f]{7,64}$/)
  }),
  z.object({ repository: z.string().min(1).max(512), number: z.number().int().positive() })
])

export const HostedReviewForBranch = z.object({
  repo: requiredString('Missing repo selector'),
  branch: requiredString('Missing branch'),
  force: z.boolean().optional(),
  userRefresh: z.boolean().optional(),
  reportReadOutcome: z.boolean().optional(),
  admissionTier: OptionalGitAdmissionTier,
  currentHeadOid: z.string().nullable().optional(),
  // Only the caller's selected worktree; the host caps how many earn the fast tier.
  active: z.boolean().optional(),
  linkedGitHubPR: z.number().int().positive().nullable().optional(),
  fallbackGitHubPR: z.number().int().positive().nullable().optional(),
  linkedGitLabMR: z.number().int().positive().nullable().optional(),
  linkedBitbucketPR: z.number().int().positive().nullable().optional(),
  linkedAzureDevOpsPR: z.number().int().positive().nullable().optional(),
  linkedGiteaPR: z.number().int().positive().nullable().optional()
})

export const HostedReviewCreationEligibility = z.object({
  repo: requiredString('Missing repo selector'),
  worktree: z.string().min(1, 'Missing worktree selector').optional(),
  branch: requiredString('Missing branch'),
  base: z.string().nullable().optional(),
  hasUncommittedChanges: z.boolean().optional(),
  hasUpstream: z.boolean().optional(),
  ahead: z.number().int().nonnegative().optional(),
  behind: z.number().int().nonnegative().optional(),
  linkedGitHubPR: z.number().int().positive().nullable().optional(),
  fallbackGitHubPR: z.number().int().positive().nullable().optional(),
  linkedGitLabMR: z.number().int().positive().nullable().optional(),
  linkedBitbucketPR: z.number().int().positive().nullable().optional(),
  linkedAzureDevOpsPR: z.number().int().positive().nullable().optional(),
  linkedGiteaPR: z.number().int().positive().nullable().optional(),
  /** The user's Create PR; older hosts drop it. */
  wakeWslDistro: OptionalBoolean
})

export const HostedReviewCreate = z.object({
  repo: requiredString('Missing repo selector'),
  worktree: z.string().min(1, 'Missing worktree selector').optional(),
  // Keep provider open: clients echo a newer host’s eligibility token; the handler refuses unsupported providers.
  provider: z.string(),
  base: requiredString('Missing base branch'),
  head: z.string().optional(),
  title: requiredString('Missing title'),
  body: z.string().optional(),
  draft: z.boolean().optional(),
  useTemplate: z.boolean().optional()
})
