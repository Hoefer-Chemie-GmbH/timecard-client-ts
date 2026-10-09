import { createPrivateKey, sign } from 'node:crypto';

/** Content of a Google service account key file (the JSON that Google Cloud downloads) */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export interface GoogleIdTokenOptions {
  /** the facade's public URL; it is the `aud` claim the facade verifies */
  audience: string;
  /** seconds before expiry at which a cached token is renewed (default 60) */
  renewBeforeSeconds?: number;
  fetch?: typeof fetch;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';

const base64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/**
 * Mints Google ID tokens for a service account and caches them until shortly before expiry.
 * The facade accepts tokens whose `aud` equals its public URL and whose subject is registered in its principal registry.
 */
export class GoogleIdTokenSource {
  private cached: { token: string; expiresAt: number } | null = null;
  private inFlight: Promise<string> | null = null;
  private readonly renewBefore: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly key: ServiceAccountKey, private readonly opts: GoogleIdTokenOptions) {
    this.renewBefore = opts.renewBeforeSeconds ?? 60;
    this.fetchImpl = opts.fetch ?? fetch;
  }

  async token(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cached && this.cached.expiresAt - this.renewBefore > now) return this.cached.token;
    if (!this.inFlight) {
      this.inFlight = this.mint().finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async mint(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: 'RS256', typ: 'JWT', ...(this.key.private_key_id ? { kid: this.key.private_key_id } : {}) };
    const claims = { iss: this.key.client_email, sub: this.key.client_email, aud: TOKEN_ENDPOINT, iat: now, exp: now + 300, target_audience: this.opts.audience };
    const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
    const signature = sign('RSA-SHA256', Buffer.from(signingInput), createPrivateKey(this.key.private_key));
    const assertion = `${signingInput}.${base64url(signature)}`;
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    const body = (await res.json()) as { id_token?: string; error?: string; error_description?: string };
    if (!res.ok || !body.id_token) throw new Error(`Google token endpoint rejected the service account assertion: ${body.error ?? res.status} ${body.error_description ?? ''}`.trim());
    const payload = JSON.parse(Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8')) as { exp?: number };
    this.cached = { token: body.id_token, expiresAt: payload.exp ?? now + 3600 };
    return body.id_token;
  }
}

/** Any source of bearer tokens, e.g. a GoogleIdTokenSource or a fixed token for tests */
export interface TokenSource {
  token(): Promise<string>;
}

export const staticToken = (token: string): TokenSource => ({ token: async () => token });
