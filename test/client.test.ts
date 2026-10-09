import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTimecardClient, staticToken, TimecardApiError, unwrap } from '../src/index.js';

test('sends the bearer token and the acting user; unwrap turns Problem Details into TimecardApiError', async () => {
  const seen: Request[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    seen.push(req);
    if (req.url.endsWith('/v1/me')) {
      return new Response(JSON.stringify({ subject: 's', displayName: 'Test', scopes: ['persons:read'], issuer: 'google' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ type: 'https://x/errors/not-found', title: 'Not found', status: 404, detail: 'Person 1 does not exist', instance: 'urn:request:abc' }), {
      status: 404, headers: { 'content-type': 'application/problem+json', 'x-request-id': 'abc' },
    });
  };
  const client = createTimecardClient({ baseUrl: 'https://facade.test', tokenSource: staticToken('tok'), actingUser: 'erika', fetch: fetchStub });
  const me = unwrap(await client.GET('/v1/me'));
  assert.equal(me.displayName, 'Test');
  assert.equal(seen[0]?.headers.get('authorization'), 'Bearer tok');
  assert.equal(seen[0]?.headers.get('x-acting-user'), 'erika');
  await assert.rejects(
    async () => unwrap(await client.GET('/v1/persons/{personId}', { params: { path: { personId: 1 } } })),
    (err: unknown) => err instanceof TimecardApiError && err.problem.status === 404 && err.requestId === 'abc',
  );
});
