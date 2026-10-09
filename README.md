# timecard-client-ts

TypeScript client for a REST facade in front of the time recording system REINER SCT timeCard. The facade offers persons, bookings, balances, absences and master data as a documented JSON API with OAuth authentication, scopes and an audit log.

This project is not affiliated with, endorsed or sponsored by REINER SCT. REINER SCT and timeCard are trademarks of their respective owner.

- API version `0.2.1`.
- Generated: `src/schema.ts` (types for every path, parameter and body).
- Hand-written: `src/auth.ts` (Google ID tokens), `src/client.ts` (client factory, Problem Details errors).

## Installation

From the Git tag of a version (npm builds the package on installation):

```
npm install "github:Hoefer-Chemie-GmbH/timecard-client-ts#v0.2.1"
```

or from the packed package attached to the GitHub release:

```
npm install https://github.com/Hoefer-Chemie-GmbH/timecard-client-ts/releases/download/v0.2.1/timecard-client-0.2.1.tgz
```

Node 20 or newer; the runtime dependency is `openapi-fetch` only.

## Authentication

The facade accepts Google ID tokens of service accounts. Each service account is registered by the operator of the facade together with the scopes it may use; ask the operator for the registration and for the base URL of the facade. The base URL is also the audience of the token. Keep the service account's JSON key outside the repository and load it from a secret store or a file outside the checkout.

```ts
import { readFile } from 'node:fs/promises';
import { createTimecardClient, GoogleIdTokenSource, unwrap } from 'timecard-client';

const baseUrl = process.env.TIMECARD_API_URL!; // e.g. https://timecard-api.example.com
const key = JSON.parse(await readFile(process.env.GOOGLE_SA_KEY_FILE!, 'utf8'));
const client = createTimecardClient({ baseUrl, tokenSource: new GoogleIdTokenSource(key, { audience: baseUrl }) });

const persons = unwrap(await client.GET('/v1/persons', { params: { query: { pageSize: 50 } } }));
```

`GoogleIdTokenSource` caches the token and renews it one minute before it expires. `createTimecardClient` returns an [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client typed with the facade's paths: `client.GET('/v1/persons/{personId}', { params: { path: { personId: 42 } } })`. Every path, query parameter, request body and response is type-checked against the specification.

## Scopes

| Scope | Allows |
|---|---|
| `persons:read` | persons, photos, calculation accounts and carry-overs |
| `persons:write` | create and change persons, photos, carry-overs |
| `persons:delete` | delete carry-overs |
| `bookings:read` | bookings, daily balances, calendar, absence overview |
| `bookings:write` | create and change bookings, absence bookings, working time profile assignments |
| `bookings:delete` | delete bookings and working time profile assignments |
| `masterdata:read` | absence types, projects, work operations, departments, groups, calculation templates, working time profiles, break rules, free fields |
| `masterdata:write` | create and change work operations |
| `masterdata:delete` | delete work operations |
| `presence:read` | presence display |
| `audit:read` | the facade's audit log |

A call outside the scopes of the service account answers `403` with a Problem Details body.

## Errors

The facade answers every error with an RFC 9457 Problem Details body (`type`, `title`, `status`, `detail`, `instance`, optional `errors[]` for validation). `unwrap()` turns such a result into a `TimecardApiError` carrying the parsed `problem` and the `requestId` (the facade's `x-request-id`, also the suffix of `instance`). Quote the request id when reporting a problem to the operator; the audit log of the facade is searchable by it.

| Status | Meaning |
|---|---|
| 400, 422 | invalid request; `errors` lists the fields |
| 401 | token missing, expired or for a different audience |
| 403 | scope missing, or the person is outside the set released for writing |
| 404 | the resource does not exist |
| 409 | the time recording system rejected the change (e.g. month closed, duplicate) |
| 429 | rate limit of the facade; wait and retry |
| 502, 503 | the time recording system is unavailable or answered unexpectedly; retry later |

Keep retries to idempotent reads; the facade already retries reads once against the time recording system.

## Acting user

When a call is made on behalf of a human user (a UI, a self-service), pass `actingUser`; it is sent as `X-Acting-User` and stored in the facade's audit log next to the service account.

## Example and tests

- `npm run example` runs `examples/read-person.ts` (needs `TIMECARD_API_URL` and `GOOGLE_SA_KEY_FILE`).
- `npm test` runs the unit tests of the hand-written layer against a stubbed `fetch`; no network.

## About this repository

The client is generated from the facade's OpenAPI specification; only the authentication helper, the Problem Details helper, the example and the tests are written by hand. The content of this repository is replaced by synchronisation pull requests whenever the specification changes, so changes made here directly would be overwritten. Report problems as issues.

The version equals the API version of the facade. Merging a synchronisation pull request releases the version if it has no tag yet. Breaking changes of the API arrive as a new major version with a new `/v2` base path.
