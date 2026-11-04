import { describe, expect, it } from 'vitest'
import type { AgentJournalToolCallItem } from './agent-session/journal/agent-session-journal-types'
import { conversationReviewMutations } from './conversation-review-mutations'

const url = 'https://git.example.com/jiri/jiri/pulls/42'
function tool(
  command: string,
  output = url,
  overrides: Partial<AgentJournalToolCallItem> = {}
): AgentJournalToolCallItem {
  return {
    kind: 'tool-call',
    name: 'Bash',
    input: { command },
    state: 'completed',
    exitCode: 0,
    output: { head: output, byteLength: output.length, digest: 'digest', truncated: false },
    ...overrides
  }
}

describe('conversation PR mutation evidence', () => {
  it('ignores numbered Qunli or documentation links without breaking the conversation scan', () => {
    expect(
      conversationReviewMutations(tool('tea pulls create', '18033 https://qunli.co/2025/T18033'))
    ).toEqual([])
    expect(
      conversationReviewMutations(tool('tea pulls create', '42 https://example.com/documentation'))
    ).toEqual([])
  })
  it('recognizes a numbered create receipt after preparing a body and piping curl output', () => {
    expect(
      conversationReviewMutations(
        tool(
          `cat > /tmp/body.md <<'EOF'
See https://git.example.com/other/repo/pulls/42
EOF
curl -s -X POST --data @/tmp/body.json https://git.example.com/api/v1/repos/jiri/jiri/pulls | python3 -c "print('response')"`,
          `42 ${url}`
        )
      )
    ).toEqual([{ action: 'created', lookup: { url } }])
  })
  it('recognizes a successful Python create script that was written and executed in the same tool', () => {
    const command = `cat > /tmp/pr.py <<'EOF'
req = urllib.request.Request("https://git.example.com/api/v1/repos/jiri/jiri/pulls", data=data, method="POST",
    headers=headers)
r = json.load(urllib.request.urlopen(req))
print(r["number"], r["html_url"])
EOF
python3 /tmp/pr.py`
    expect(conversationReviewMutations(tool(command, `42 ${url}`))).toEqual([
      { action: 'created', lookup: { url } }
    ])
    expect(
      conversationReviewMutations(
        tool(command.replace('python3 /tmp/pr.py', 'cat /tmp/pr.py'), `42 ${url}`)
      )
    ).toEqual([])
  })
  it('recognizes JSON creation receipts from a jq/curl pipeline with a dynamic auth header', () => {
    const command = `body=$(cat <<'EOF'
See https://git.example.com/other/repo/pulls/99
EOF
); jq -n --arg title "A PR" --arg body "$body" '{title:$title,body:$body}' | curl -sS -X POST -H "Authorization: token $(cat ~/.config/gitea/token)" -H "Content-Type: application/json" -d @- https://git.example.com/api/v1/repos/jiri/jiri/pulls | jq '{number, html_url, state}'`
    expect(
      conversationReviewMutations(
        tool(command, JSON.stringify({ number: 42, html_url: url, state: 'open' }, null, 2))
      )
    ).toEqual([{ action: 'created', lookup: { url } }])
  })
  it.each([
    url,
    `${url}\nShell cwd was reset to /unrelated/worktree`,
    `Created pull request: ${url}\nDone.`,
    `42 ${url}`,
    `[Open pull request](${url})`,
    `\u001b[32m${url}\u001b[0m`,
    JSON.stringify({
      number: 42,
      html_url: url,
      body: 'See https://git.example.com/jiri/jiri/pulls/99'
    }),
    `${JSON.stringify({ number: 42, html_url: url }, null, 2)}\nShell cwd was reset to /other`,
    JSON.stringify({ html_url: url }),
    JSON.stringify({ exit_code: 0, output: `${url}\nShell cwd was reset to /other` }),
    JSON.stringify({
      result: { content: [{ type: 'text', text: JSON.stringify({ number: 42, html_url: url }) }] }
    })
  ])('uses the same creation identity across response representations: %s', (output) => {
    const command = `cd /other/repo && BODY=$(cat <<'EOF'
Related: https://git.example.com/jiri/jiri/pulls/99
EOF
); jq -n --arg body "$BODY" '{body:$body}' | curl -s -X POST -H "Authorization: token $(cat ~/.config/gitea/token)" https://git.example.com/api/v1/repos/jiri/jiri/pulls -d @- | jq -r '.html_url // .message'`
    expect(conversationReviewMutations(tool(command, output))).toEqual([
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/jiri/pulls/42' } }
    ])
  })
  it('unwraps command and result envelopes before matching an API creation', () => {
    expect(
      conversationReviewMutations(
        tool('', JSON.stringify({ result: { exit_code: 0, stdout: url } }), {
          name: 'functions.exec',
          input: {
            code: 'text(await tools.exec_command({cmd:"curl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls | jq -r .html_url"}))'
          }
        })
      )
    ).toEqual([
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/jiri/pulls/42' } }
    ])
  })
  it.each([
    'curl -XPOST --url https://git.example.com/api/v1/repos/jiri/jiri/pulls',
    'curl --request=POST --url=https://git.example.com/api/v1/repos/jiri/jiri/pulls',
    'curl --json @body.json https://git.example.com/api/v1/repos/jiri/jiri/pulls',
    'curl --data-binary=@body.json https://git.example.com/api/v1/repos/jiri/jiri/pulls/?unused=1'
  ])('matches creation requests through normalized curl options: %s', (command) => {
    expect(conversationReviewMutations(tool(command, url))).toEqual([
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/jiri/pulls/42' } }
    ])
  })
  it('keeps separate returned identities for a tool that creates PRs in multiple repositories', () => {
    expect(
      conversationReviewMutations(
        tool(
          'curl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls; curl -X POST https://git.example.com/api/v1/repos/jiri/nextfe/pulls',
          `${url}\nhttps://git.example.com/jiri/nextfe/pulls/7`
        )
      )
    ).toEqual([
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/jiri/pulls/42' } },
      { action: 'created', lookup: { url: 'https://git.example.com/jiri/nextfe/pulls/7' } }
    ])
  })
  it.each([
    'curl -G --data query=1 https://git.example.com/api/v1/repos/jiri/jiri/pulls',
    'curl -X POST --data https://git.example.com/api/v1/repos/jiri/jiri/pulls https://git.example.com/api/v1/repos/other/repo/pulls',
    'curl --format https://git.example.com/api/v1/repos/jiri/jiri/pulls'
  ])('does not infer create targets from GET parameters or body arguments: %s', (command) => {
    expect(conversationReviewMutations(tool(command, url))).toEqual([])
  })
  it.each([
    `Error creating PR: ${url}`,
    `Already exists: ${url}`,
    JSON.stringify({ message: `Already exists: ${url}` }),
    JSON.stringify({ body: `See ${url}`, description: url }),
    JSON.stringify({ number: 43, html_url: url, body: url }),
    JSON.stringify({ isError: true, content: [{ type: 'text', text: url }] }),
    JSON.stringify({ exit_code: 1, output: url }),
    JSON.stringify({ result: { ok: false, url } }),
    JSON.stringify({ status: 422, message: url }),
    JSON.stringify({ errors: ['rejected'], url }),
    `${url}\nhttps://git.example.com/jiri/jiri/pulls/99`
  ])('rejects error envelopes, body mentions and ambiguous creation results: %s', (output) => {
    expect(
      conversationReviewMutations(
        tool(
          'printf payload | curl -X POST -d @- https://git.example.com/api/v1/repos/jiri/jiri/pulls | jq .',
          output
        )
      )
    ).toEqual([])
  })
  it.each([
    `printf payload|curl -X POST -H "Authorization: token \`cat ~/.config/gitea/token\`" -d @- https://git.example.com/api/v1/repos/jiri/jiri/pulls|jq .`,
    `curl \\\n-X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls`
  ])('recognizes literal create requests with shell argument substitutions: %s', (command) => {
    expect(
      conversationReviewMutations(tool(command, JSON.stringify({ number: 42, html_url: url })))
    ).toEqual([{ action: 'created', lookup: { url } }])
  })
  it.each([
    `curl https://git.example.com/api/v1/repos/jiri/jiri/pulls/42 | jq .`,
    `printf '%s' 'curl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls' | cat`,
    `echo "$(printf 'curl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls')"`,
    `# curl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls\necho receipt`,
    `cat <<'EOF'\ncurl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls\nEOF`,
    `echo ignored; curl -X "$METHOD" https://git.example.com/api/v1/repos/jiri/jiri/pulls`,
    `echo ignored; curl -X POST "$(echo https://git.example.com/api/v1/repos/jiri/jiri/pulls)"`,
    `echo ignored; curl -X POST https://git.example.com/api/v1/repos/other/repo/pulls`,
    `printf payload | curl -X POST 'https://[/api/v1/repos/jiri/jiri/pulls'`
  ])('excludes JSON receipts without a literal matching create command: %s', (command) => {
    expect(
      conversationReviewMutations(tool(command, JSON.stringify({ number: 42, html_url: url })))
    ).toEqual([])
  })
  it.each([
    { number: 43, html_url: url },
    { number: '42', html_url: url },
    { number: 42, html_url: 'https://git.example.com/other/repo/pulls/42' },
    { message: 'Unauthorized' }
  ])('rejects mismatched or unsuccessful JSON creation receipts: %j', (receipt) => {
    expect(
      conversationReviewMutations(
        tool(
          'printf payload | curl -X POST -d @- https://git.example.com/api/v1/repos/jiri/jiri/pulls | jq .',
          JSON.stringify(receipt)
        )
      )
    ).toEqual([])
  })
  it.each([
    `curl -X GET --data 'example -X POST here' https://git.example.com/api/v1/repos/jiri/jiri/pulls`,
    `curl -X POST https://git.example.com/api/v1/repos/other/repo/pulls`,
    `cat > /tmp/example <<'EOF'\ncurl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls\nEOF\necho receipt`,
    `curl https://git.example.com/api/v1/repos/jiri/jiri/pulls/42`,
    `echo 'curl -X POST https://git.example.com/api/v1/repos/jiri/jiri/pulls'`
  ])(
    'does not attribute numbered receipts to unrelated reads or quoted commands: %s',
    (command) => {
      expect(conversationReviewMutations(tool(command, `42 ${url}`))).toEqual([])
    }
  )
  it('does not attribute a PR that is only mentioned in another PR description', () => {
    expect(
      conversationReviewMutations(
        tool(`tea pulls edit 99 --repo jiri/nextfe --description "See ${url}"`, 'Updated PR')
      )
    ).toEqual([{ action: 'updated', lookup: { repository: 'jiri/nextfe', number: 99 } }])
  })
  it('uses an explicit tool working directory for numeric edits, including Windows paths', () => {
    const changed = tool('tea pulls edit 42', 'Updated PR', {
      input: { command: 'tea pulls edit 42', workdir: 'C:\\repos\\jiri' }
    })
    expect(conversationReviewMutations(changed, '/different-repo')).toEqual([
      { action: 'updated', lookup: { directory: 'C:\\repos\\jiri', number: 42 } }
    ])
    expect(conversationReviewMutations(tool('tea pulls edit 42', 'Updated PR'), '/repo')).toEqual([
      { action: 'updated', lookup: { directory: '/repo', number: 42 } }
    ])
  })
  it('does not infer a repo from an unsupported repo override or quoted executable code', () => {
    expect(
      conversationReviewMutations(
        tool('tea pulls edit 42 --repo https://other.example/a/b', 'Updated PR'),
        '/repo'
      )
    ).toEqual([])
    expect(
      conversationReviewMutations(
        tool('', url, {
          input: { code: `text("await tools.exec_command({cmd:'tea pulls create'})")` }
        })
      )
    ).toEqual([])
  })
  it('does not call a curl transport success an API write success', () => {
    expect(
      conversationReviewMutations(
        tool(
          'curl -X PATCH https://git.example.com/api/v1/repos/jiri/jiri/pulls/42',
          '{"message":"Unauthorized"}'
        )
      )
    ).toEqual([])
  })
  it.each([
    'tea pulls list',
    'tea pulls 42',
    'gh pr view 42',
    'gh pr list',
    `echo "tea pulls create ${url}"`,
    `curl ${url}`,
    'git log'
  ])('excludes read-only and quoted operations: %s', (command) => {
    expect(conversationReviewMutations(tool(command))).toEqual([])
  })
  it.each([
    { state: 'failed' as const },
    { state: 'running' as const },
    { exitCode: 1 },
    { endedAs: 'interrupted' as const }
  ])('excludes unsuccessful writes: %j', (overrides) => {
    expect(conversationReviewMutations(tool('tea pulls create', url, overrides))).toEqual([])
  })
  it('records a creation once even when structured output repeats its URL', () => {
    expect(
      conversationReviewMutations(
        tool('tea pulls create --repo jiri/jiri', JSON.stringify({ html_url: url, output: url }))
      )
    ).toEqual([{ action: 'created', lookup: { url } }])
  })
  it('records an exact modification without requiring the current workspace repo', () => {
    expect(
      conversationReviewMutations(
        tool('cd /other/repo && tea pulls edit 42 --repo jiri/jiri', 'Updated PR')
      )
    ).toEqual([{ action: 'updated', lookup: { repository: 'jiri/jiri', number: 42 } }])
  })
  it('reads literal shell invocations and receipts wrapped by functions.exec', () => {
    const output = JSON.stringify({
      exit_code: 0,
      output: 'To git@git.example.com:jiri/nextfe.git\n   abcd123..abcd456  feature -> feature\n'
    })
    expect(
      conversationReviewMutations(
        tool('', output, {
          name: 'functions.exec',
          input: {
            code: 'text(await tools.exec_command({workdir:"/repo",cmd:"git push origin feature"}))'
          }
        })
      )
    ).toEqual([
      {
        action: 'updated',
        lookup: {
          remoteUrl: 'git@git.example.com:jiri/nextfe.git',
          branch: 'feature',
          headSha: 'abcd456'
        }
      }
    ])
  })
  it('does not mistake a rejected or no-op push for an update', () => {
    expect(
      conversationReviewMutations(
        tool(
          'git push --dry-run',
          'To git@git.example.com:jiri/jiri.git\n   abc1234..abc5678  feature -> feature\n'
        )
      )
    ).toEqual([])
    expect(conversationReviewMutations(tool('git push', 'Everything up-to-date'))).toEqual([])
    expect(
      conversationReviewMutations(
        tool('git push', `To git@git.example.com:jiri/jiri.git\n ! [rejected] feature -> feature`)
      )
    ).toEqual([])
  })
  it('normalizes an API update to its review page', () => {
    expect(
      conversationReviewMutations(
        tool(
          'curl -X PATCH https://git.example.com/api/v1/repos/jiri/jiri/pulls/42',
          JSON.stringify({ number: 42, html_url: url })
        )
      )
    ).toEqual([{ action: 'updated', lookup: { url } }])
  })
  it('rejects nonzero exit receipts even when a wrapper tool completed', () => {
    expect(
      conversationReviewMutations(
        tool('tea pulls create', JSON.stringify({ exit_code: 1, output: url }))
      )
    ).toEqual([])
  })
  it('keeps uncertain compound commands unattributed', () => {
    expect(conversationReviewMutations(tool(`tea pulls create; tea pulls list`, url))).toEqual([])
  })
})
