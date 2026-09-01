import { describe, expect, it } from 'bun:test'
import { persistFileAndVerify } from './api'

type FetchCall = { url: string; init?: RequestInit }

function sequenceFetcher(responses: Array<Response | Error>) {
  const calls: FetchCall[] = []
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) throw new Error('Unexpected fetch')
    if (next instanceof Error) throw next
    return next
  })
  return { fetcher, calls }
}

describe('persistFileAndVerify', () => {
  it('uses the validator returned by the write without a race-prone refetch', async () => {
    const { fetcher, calls } = sequenceFetcher([
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { ETag: '"fresh-etag"' } }),
    ])

    const result = await persistFileAndVerify({
      path: 'vault/Notes/Verified.md',
      body: '# Verified\n',
      ifMatch: '"old-etag"',
      fetcher,
      apiBase: '/app/md-ops',
    })

    expect(result).toEqual({ status: 'ok', savedContent: '# Verified\n', etag: '"fresh-etag"' })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/app/md-ops/api/file?path=vault%2FNotes%2FVerified.md')
    expect(calls[0]?.init?.method).toBe('PUT')
    expect((calls[0]?.init?.headers as Record<string, string>)['If-Match']).toBe('"old-etag"')
  })

  it('supports the legacy API only after refetching matching content and a validator', async () => {
    const { fetcher, calls } = sequenceFetcher([
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Response('# Verified\n', { status: 200, headers: { ETag: '"legacy-etag"' } }),
    ])

    const result = await persistFileAndVerify({ path: 'vault/note.md', body: '# Verified\n', fetcher })

    expect(result).toEqual({ status: 'ok', savedContent: '# Verified\n', etag: '"legacy-etag"' })
    expect(calls).toHaveLength(2)
    expect(calls[1]?.init).toBeUndefined()
  })

  it('records write acceptance and requires reload when the legacy verification refetch is non-2xx', async () => {
    const { fetcher } = sequenceFetcher([
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 }),
    ])

    const result = await persistFileAndVerify({ path: 'vault/note.md', body: 'local draft', fetcher })

    expect(result.status).toBe('reload-required')
    expect(result.status === 'reload-required' ? result.writeAccepted : false).toBe(true)
    expect(result.status === 'reload-required' ? result.savedContent : '').toBe('local draft')
    expect(result.status === 'reload-required' ? result.message : '').toContain('verification failed (HTTP 503)')
    expect(result.status === 'reload-required' ? result.message : '').toContain('reload before editing again')
  })

  it('distinguishes post-write reconciliation failures from pre-write conflicts', async () => {
    const missingEtag = sequenceFetcher([
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Response('local draft', { status: 200 }),
    ])
    const changedContent = sequenceFetcher([
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Response('newer remote content', { status: 200, headers: { ETag: '"newer"' } }),
    ])

    const missingEtagResult = await persistFileAndVerify({ path: 'vault/note.md', body: 'local draft', fetcher: missingEtag.fetcher })
    const changedContentResult = await persistFileAndVerify({ path: 'vault/note.md', body: 'local draft', fetcher: changedContent.fetcher })

    expect(missingEtagResult.status).toBe('reload-required')
    expect(changedContentResult).toEqual({
      status: 'reload-required',
      savedContent: 'local draft',
      writeAccepted: true,
      message: 'The server accepted your save, but the file changed again before verification finished. Copy your local draft, then reload and reconcile the latest version.',
    })
  })

  it('preserves the conflict path without issuing a verification read', async () => {
    const { fetcher, calls } = sequenceFetcher([
      new Response(JSON.stringify({ error: 'conflict' }), { status: 409 }),
    ])

    const result = await persistFileAndVerify({ path: 'vault/note.md', body: 'local draft', fetcher })

    expect(result).toEqual({ status: 'conflict', message: 'File was modified elsewhere. Refetch to get latest.' })
    expect(calls).toHaveLength(1)
  })

  it('requires reload instead of reporting failure when a post-write verification read throws', async () => {
    const { fetcher } = sequenceFetcher([
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
      new Error('connection reset'),
    ])

    const result = await persistFileAndVerify({ path: 'vault/note.md', body: 'local draft', fetcher })

    expect(result.status).toBe('reload-required')
    expect(result.status === 'reload-required' ? result.writeAccepted : false).toBe(true)
    expect(result.status === 'reload-required' ? result.message : '').toContain('could not verify')
    expect(result.status === 'reload-required' ? result.message : '').toContain('reload before editing again')
  })

  it('still reports a pre-write network failure as an ordinary error', async () => {
    const { fetcher } = sequenceFetcher([new Error('connection refused')])

    const result = await persistFileAndVerify({ path: 'vault/note.md', body: 'local draft', fetcher })

    expect(result).toEqual({ status: 'err', message: 'connection refused' })
  })
})
