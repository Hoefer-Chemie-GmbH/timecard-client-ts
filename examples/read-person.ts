// Reads the calling principal, lists three persons and the bookings of one person.
// Environment: TIMECARD_API_URL (base URL of the facade), GOOGLE_SA_KEY_FILE (path to the service account JSON).
import { readFile } from 'node:fs/promises';
import { createTimecardClient, GoogleIdTokenSource, unwrap, type ServiceAccountKey } from '../src/index.js';

const baseUrl = process.env.TIMECARD_API_URL;
if (!baseUrl) throw new Error('set TIMECARD_API_URL to the base URL of the facade');
const key = JSON.parse(await readFile(process.env.GOOGLE_SA_KEY_FILE ?? 'service-account.json', 'utf8')) as ServiceAccountKey;
const client = createTimecardClient({ baseUrl, tokenSource: new GoogleIdTokenSource(key, { audience: baseUrl }) });

const me = unwrap(await client.GET('/v1/me'));
console.log('principal', me.displayName, 'scopes', me.scopes);

const persons = unwrap(await client.GET('/v1/persons', { params: { query: { pageSize: 3 } } }));
for (const p of persons.items) console.log(p.id, p.personNo, p.lastName, p.firstName);

const first = persons.items[0];
if (first) {
  const bookings = unwrap(await client.GET('/v1/persons/{personId}/bookings', { params: { path: { personId: first.id }, query: { date: new Date().toISOString().slice(0, 10) } } }));
  console.log('bookings today', bookings.items.length);
}
