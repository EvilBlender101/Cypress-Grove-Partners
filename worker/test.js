// Tests for the intake Worker with Twenty, Turnstile and ntfy faked. Run: node worker/test.js
import assert from 'node:assert/strict';
import worker, { nextBusinessDay, phoneFields } from './index.js';

const ORIGIN = 'https://cypressgrove.partners';
const env = {
  ALLOWED_ORIGINS: ORIGIN + ',https://www.cypressgrove.partners',
  TWENTY_API_URL: 'https://api.twenty.test',
  TWENTY_APP_URL: 'https://crm.test',
  TWENTY_API_KEY: 'test-key',
  TURNSTILE_SECRET: 'test-secret',
  NTFY_TOPIC: 'test-topic',
  ASSETS: { fetch: async () => new Response('asset') }
};

// Fake upstream services. Each test sets `twentyRules` to change Twenty's behaviour.
let calls = [];
let twentyRules = {};
let ids = 0;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  const body = init.body instanceof FormData ? Object.fromEntries(init.body) : init.body ? (typeof init.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init.body) : null;
  calls.push({ url, method: init.method || 'GET', body, headers: init.headers || {} });
  if (url.startsWith('https://challenges.cloudflare.com/')) {
    return Response.json({ success: body.response === 'good-token' });
  }
  if (url.startsWith('https://ntfy.sh/')) return new Response('ok');
  if (url.startsWith('https://api.twenty.test/rest/')) {
    const path = url.slice('https://api.twenty.test/rest/'.length).split('?')[0];
    const rule = twentyRules[path];
    if (rule) {
      const r = rule(body, init.method || 'GET');
      if (r) return r;
    }
    if ((init.method || 'GET') === 'GET') return Response.json({ data: { people: [] } });
    return Response.json({ data: { ['create' + path]: { id: path + '-' + ++ids } } });
  }
  throw new Error('unexpected fetch ' + url);
};

const waits = [];
const ctx = { waitUntil: (p) => waits.push(p) };

function post(body, { origin = ORIGIN, type = 'application/json' } = {}) {
  return worker.fetch(new Request(ORIGIN + '/api/intake', {
    method: 'POST',
    headers: { 'Content-Type': type, Origin: origin, 'CF-Connecting-IP': '203.0.113.9' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }), env, ctx);
}

const good = {
  name: 'Dana Reyes', email: 'Dana@ReyesMachine.com', phone: '(813) 555-0142', company: 'Reyes Machine',
  makes: 'CNC parts for aerospace', county: 'Pinellas', amount: '$1M to $2M', use: 'Equipment',
  notes: 'Adding a 5 axis cell.', website: '', 'cf-turnstile-response': 'good-token'
};

async function run(name, fn) {
  calls = []; twentyRules = {}; waits.length = 0;
  await fn();
  await Promise.all(waits);
  console.log('ok  ' + name);
}

const twentyCalls = () => calls.filter((c) => c.url.includes('api.twenty.test'));
const pushes = () => calls.filter((c) => c.url.startsWith('https://ntfy.sh/'));

await run('static pages go to assets', async () => {
  const res = await worker.fetch(new Request(ORIGIN + '/'), env, ctx);
  assert.equal(await res.text(), 'asset');
});

await run('GET on the endpoint is refused', async () => {
  const res = await worker.fetch(new Request(ORIGIN + '/api/intake'), env, ctx);
  assert.equal(res.status, 405);
});

await run('a new inquiry creates company, person, opportunity, note, task and links', async () => {
  const res = await post(good);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const paths = twentyCalls().map((c) => c.method + ' ' + c.url.split('/rest/')[1].split('?')[0]);
  assert.deepEqual(paths, [
    'GET people', 'POST companies', 'POST people', 'POST opportunities',
    'POST notes', 'POST noteTargets', 'POST noteTargets', 'POST noteTargets',
    'POST tasks', 'POST taskTargets', 'POST taskTargets', 'POST taskTargets'
  ]);
  const find = (p) => twentyCalls().find((c) => c.method === 'POST' && c.url.endsWith('/rest/' + p)).body;
  assert.equal(find('companies').name, 'Reyes Machine');
  assert.equal(find('companies').domainName.primaryLinkUrl, 'https://reyesmachine.com');
  assert.equal(find('companies').county, 'PINELLAS');
  assert.deepEqual(find('companies').relationshipType, ['BORROWER']);
  const person = find('people');
  assert.deepEqual(person.name, { firstName: 'Dana', lastName: 'Reyes' });
  assert.equal(person.emails.primaryEmail, 'dana@reyesmachine.com');
  assert.deepEqual(person.phones, { primaryPhoneNumber: '8135550142', primaryPhoneCountryCode: 'US', primaryPhoneCallingCode: '+1' });
  assert.equal(person.companyId, 'companies-1');
  assert.equal(person.typeCustom, 'BORROWER');
  assert.equal(find('opportunities').pointOfContactId, 'people-2');
  assert.equal(find('opportunities').stage, 'LEAD');
  const links = twentyCalls().filter((c) => c.url.endsWith('/rest/noteTargets')).map((c) => Object.keys(c.body).sort().join(','));
  assert.deepEqual(links, ['noteId,targetPersonId', 'noteId,targetCompanyId', 'noteId,targetOpportunityId']);
  assert.match(twentyCalls()[0].headers['User-Agent'], /cypressgrove-website/);
  assert.match(find('notes').bodyV2.markdown, /Makes: CNC parts for aerospace/);
  assert.equal(find('tasks').status, 'TODO');
  const lookup = twentyCalls()[0].url;
  assert.match(decodeURIComponent(lookup), /emails\.primaryEmail\[eq\]:"dana@reyesmachine\.com"/);
  assert.equal(twentyCalls()[0].headers.Authorization, 'Bearer test-key');
  // The push carries no personal details
  assert.equal(pushes().length, 1);
  const p = pushes()[0];
  assert.equal(p.headers.Title, 'New website inquiry');
  assert.doesNotMatch(p.body + JSON.stringify(p.headers), /Dana|Reyes|reyesmachine|555/);
});

await run('a returning person is reused, not duplicated', async () => {
  twentyRules.people = (body, method) => method === 'GET'
    ? Response.json({ data: { people: [{ id: 'person-old', companyId: 'company-old' }] } }) : null;
  const res = await post(good);
  assert.equal(res.status, 200);
  const posts = twentyCalls().filter((c) => c.method === 'POST').map((c) => c.url.split('/rest/')[1]);
  assert.ok(!posts.includes('people') && !posts.includes('companies'));
  const opp = twentyCalls().find((c) => c.url.endsWith('/rest/opportunities')).body;
  assert.equal(opp.companyId, 'company-old');
  assert.equal(opp.pointOfContactId, 'person-old');
});

await run('free mail addresses do not set a company domain', async () => {
  await post({ ...good, email: 'dana@gmail.com' });
  const company = twentyCalls().find((c) => c.url.endsWith('/rest/companies')).body;
  assert.equal(company.domainName, undefined);
});

await run('Twenty rejecting phones retries the person without them', async () => {
  let first = true;
  twentyRules.people = (body, method) => {
    if (method === 'POST' && first) { first = false; return new Response('bad phone', { status: 400 }); }
    return null;
  };
  const res = await post(good);
  assert.equal(res.status, 200);
  const personPosts = twentyCalls().filter((c) => c.method === 'POST' && c.url.endsWith('/rest/people'));
  assert.equal(personPosts.length, 2);
  assert.equal(personPosts[1].body.phones, undefined);
});

await run('Twenty rejecting bodyV2 falls back to body', async () => {
  twentyRules.notes = (body) => (body.bodyV2 ? new Response('unknown field', { status: 400 }) : null);
  twentyRules.tasks = twentyRules.notes;
  const res = await post(good);
  assert.equal(res.status, 200);
  const notes = twentyCalls().filter((c) => c.url.endsWith('/rest/notes'));
  assert.equal(notes.length, 2);
  assert.match(notes[1].body.body, /Website inquiry/);
});

await run('a later step failing still counts as saved', async () => {
  twentyRules.opportunities = () => new Response('nope', { status: 500 });
  const res = await post(good);
  assert.equal(res.status, 200);
  const noteLinks = twentyCalls().filter((c) => c.url.endsWith('/rest/noteTargets'));
  assert.equal(noteLinks.length, 2); // person and company, no opportunity
});

await run('Twenty failing to save the person returns an error and a warning push', async () => {
  twentyRules.people = (body, method) => (method === 'POST' ? new Response('down', { status: 503 }) : null);
  const res = await post(good);
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /didn’t send/);
  assert.equal(pushes()[0].headers.Title, 'Website inquiry failed to save');
});

await run('a failed spam check is refused before Twenty', async () => {
  const res = await post({ ...good, 'cf-turnstile-response': 'bad-token' });
  assert.equal(res.status, 400);
  assert.equal(twentyCalls().length, 0);
});

await run('the hidden trap field drops the submission quietly', async () => {
  const res = await post({ ...good, website: 'http://spam.example' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});

await run('other origins are refused', async () => {
  const res = await post(good, { origin: 'https://evil.example' });
  assert.equal(res.status, 403);
  assert.equal(calls.length, 0);
});

await run('form encoded bodies are refused', async () => {
  const res = await post('name=x', { type: 'application/x-www-form-urlencoded' });
  assert.equal(res.status, 415);
});

await run('oversized bodies are refused', async () => {
  const res = await post({ ...good, notes: 'x'.repeat(20000) });
  assert.equal(res.status, 413);
});

await run('bad fields get a specific message', async () => {
  for (const [patch, msg] of [
    [{ email: 'not-an-email' }, /email address/],
    [{ name: '' }, /your name/],
    [{ county: 'Orange' }, /county/],
    [{ amount: '$99M' }, /amount/],
    [{ makes: '' }, /what your shop makes/]
  ]) {
    const res = await post({ ...good, ...patch });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, msg);
  }
  assert.equal(twentyCalls().length, 0);
});

await run('helpers', async () => {
  assert.equal(phoneFields('1-813-555-0142').primaryPhoneNumber, '8135550142');
  assert.equal(phoneFields('555-0142'), null);
  assert.equal(nextBusinessDay(new Date('2026-11-06T20:00:00Z')), '2026-11-09T14:00:00.000Z'); // Friday to Monday
  assert.equal(nextBusinessDay(new Date('2026-11-03T20:00:00Z')), '2026-11-04T14:00:00.000Z');
});

console.log('all tests passed');
