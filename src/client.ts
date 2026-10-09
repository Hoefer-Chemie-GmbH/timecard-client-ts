import createClient, { type Client, type Middleware } from 'openapi-fetch';
import type { paths } from './schema.js';
import type { TokenSource } from './auth.js';

/** RFC 9457 Problem Details as the facade returns them for every error */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance: string;
  errors?: Array<{ path: string; message: string }>;
  [key: string]: unknown;
}

/** Thrown by `unwrap()` when the facade answers with a Problem Details body */
export class TimecardApiError extends Error {
  constructor(
    readonly problem: ProblemDetails,
    /** value of the `x-request-id` response header, equals the `instance` without the `urn:request:` prefix */
    readonly requestId: string | null,
  ) {
    super(`${problem.status} ${problem.title}${problem.detail ? `: ${problem.detail}` : ''}`);
    this.name = 'TimecardApiError';
  }
}

export interface TimecardClientOptions {
  /** base URL of the facade, e.g. https://timecard-api.example.com */
  baseUrl: string;
  tokenSource: TokenSource;
  /** optional user on whose behalf the call is made; recorded in the facade's audit log as `actingUser` */
  actingUser?: string;
  fetch?: typeof fetch;
}

export type TimecardClient = Client<paths>;

/** Creates an openapi-fetch client with bearer authentication and the facade's headers. */
export function createTimecardClient(opts: TimecardClientOptions): TimecardClient {
  const client = createClient<paths>({ baseUrl: opts.baseUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}) });
  const auth: Middleware = {
    async onRequest({ request }) {
      request.headers.set('authorization', `Bearer ${await opts.tokenSource.token()}`);
      if (opts.actingUser) request.headers.set('x-acting-user', opts.actingUser);
      return request;
    },
  };
  client.use(auth);
  return client;
}

/** Returns `data` of an openapi-fetch result or throws a TimecardApiError built from the Problem Details body. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || !result.response.ok) {
    const problem = (isProblem(result.error) ? result.error : { type: 'about:blank', title: result.response.statusText, status: result.response.status, instance: '' }) as ProblemDetails;
    throw new TimecardApiError(problem, result.response.headers.get('x-request-id'));
  }
  return result.data as T;
}

const isProblem = (v: unknown): v is ProblemDetails => typeof v === 'object' && v !== null && 'status' in v && 'title' in v;
