# timecard-client-ts

TypeScript client for a REST facade in front of the time recording system REINER SCT timeCard. The facade offers persons, bookings, balances, absences and master data as a documented JSON API with OAuth authentication, scopes and an audit log.

This project is not affiliated with, endorsed or sponsored by REINER SCT. REINER SCT and timeCard are trademarks of their respective owner.

- API version `0.2.2`.
- Generated: `src/schema.ts` (types for every path, parameter and body).
- Hand-written: `src/auth.ts` (Google ID tokens), `src/client.ts` (client factory, Problem Details errors).

## Installation

From the Git tag of a version (npm builds the package on installation):

```
npm install "github:Hoefer-Chemie-GmbH/timecard-client-ts#v0.2.2"
```

or from the packed package attached to the GitHub release:

```
npm install https://github.com/Hoefer-Chemie-GmbH/timecard-client-ts/releases/download/v0.2.2/timecard-client-0.2.2.tgz
```

Node 20 or newer; the runtime dependency is `openapi-fetch` only.

## Getting access

Access is granted per system by the operator of the facade; there is no self-service registration. Ask the operator for access with:

| Information | Example |
|---|---|
| System name | `hr-sync` (one service account per system and environment) |
| Responsible person | name and e-mail address |
| Purpose | "synchronises employees every 15 minutes" |
| Scopes | `persons:read`, `bookings:read` (see [Scopes](#scopes)) |
| Write access | which operations, if any |
| Runtime | Google Cloud, another cloud, on premises, developer machine |
| Expected volume | calls per hour, peaks |
| Validity | open-ended, or an end date for development and tests |
| Source addresses | fixed addresses, if access should be restricted to them |

The operator returns the base URL of the facade and a Google service account registered with the granted scopes, either as a JSON key or as the permission to obtain tokens for it without a key (see [Without a key file](#without-a-key-file)). The first call after the setup is `GET /v1/me`: it needs no scope and returns the registered name and scopes.

| Answer of `GET /v1/me` | Cause |
|---|---|
| `200` | access works; compare the scopes with the request |
| `401` | no token, token expired, or an audience other than the base URL |
| `403` | service account not registered, disabled or expired, or the source address is not allowed |

## Authentication

The facade accepts Google ID tokens of service accounts. Each service account is registered by the operator of the facade together with the scopes it may use; the operator provides the service account and the base URL of the facade (see [Getting access](#getting-access)). The base URL is also the audience of the token. Keep the service account's JSON key outside the repository and load it from a secret store or a file outside the checkout.

```ts
import { readFile } from 'node:fs/promises';
import { createTimecardClient, GoogleIdTokenSource, unwrap } from 'timecard-client';

const baseUrl = process.env.TIMECARD_API_URL!; // e.g. https://timecard-api.example.com
const key = JSON.parse(await readFile(process.env.GOOGLE_SA_KEY_FILE!, 'utf8'));
const client = createTimecardClient({ baseUrl, tokenSource: new GoogleIdTokenSource(key, { audience: baseUrl }) });

const persons = unwrap(await client.GET('/v1/persons', { params: { query: { pageSize: 50 } } }));
```

`GoogleIdTokenSource` caches the token and renews it one minute before it expires. `createTimecardClient` returns an [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client typed with the facade's paths: `client.GET('/v1/persons/{personId}', { params: { path: { personId: 42 } } })`. Every path, query parameter, request body and response is type-checked against the specification.

### Without a key file

A key file is a long-lived secret. Where the system runs on Google Cloud as the registered service account (Cloud Run, GKE, Compute Engine), the metadata server issues the ID token. Elsewhere the operator can allow the system's own identity to obtain tokens for the service account: IAM Credentials API `generateIdToken` with `includeEmail: true`, or Workload Identity Federation. The token must carry the `email` claim; the metadata server includes it only with `format=full`.

```ts
import { createTimecardClient, type TokenSource } from 'timecard-client';

const metadataToken: TokenSource = {
  async token() {
    const url = `http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity?audience=${encodeURIComponent(baseUrl)}&format=full`;
    const res = await fetch(url, { headers: { 'Metadata-Flavor': 'Google' } });
    if (!res.ok) throw new Error(`metadata server answered ${res.status}`);
    return res.text();
  },
};
const client = createTimecardClient({ baseUrl, tokenSource: metadataToken });
```

The client asks the token source before every request; the metadata server caches the token and renews it itself.

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
| `masterdata:write` | create and change projects and work operations |
| `masterdata:delete` | delete projects and work operations |
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

Retries are covered under [Operating rules](#operating-rules).

## Operating rules

- **Data.** The facade reads and changes the data of the connected time recording installation. Ask the operator whether a separate test installation exists; without one, development and tests work on real personal data and fall under the same data protection rules as production.
- **Write access.** The operator can release write access for selected persons only, for example a test person during development; calls for other persons answer `403` without reaching the time recording system.
- **Rate limit.** The facade limits the calls per service account (by default 120 per minute) and answers `429` above it; spread bulk processing over time.
- **Retries.** Retry reads after `502` or `503` with a pause; the facade itself already retries a read once against the time recording system. Do not repeat a failed write blindly: the time recording system has no idempotency keys, so a repeated write can book twice; read the current state first.
- **Audit.** The facade records every call with the service account, route, parameters and status.
- **Versions.** Install a fixed version (Git tag) and update deliberately; before 1.0.0 a minor version may contain incompatible changes.

## Acting user

When a call is made on behalf of a human user (a UI, a self-service), pass `actingUser`; it is sent as `X-Acting-User` and stored in the facade's audit log next to the service account.

## Example and tests

- `npm run example` runs `examples/read-person.ts` (needs `TIMECARD_API_URL` and `GOOGLE_SA_KEY_FILE`).
- `npm test` runs the unit tests of the hand-written layer against a stubbed `fetch`; no network.

## About this repository

The client is generated from the facade's OpenAPI specification; only the authentication helper, the Problem Details helper, the example and the tests are written by hand. The content of this repository is replaced by synchronisation pull requests whenever the specification changes, so changes made here directly would be overwritten. Report problems as issues.

The version equals the API version of the facade. Merging a synchronisation pull request releases the version if it has no tag yet. Breaking changes of the API arrive as a new major version with a new `/v2` base path.
