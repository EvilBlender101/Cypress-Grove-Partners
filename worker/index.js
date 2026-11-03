// Cloudflare Worker for cypressgrove.partners.
// Static pages are served from the assets binding; this script only handles
// POST /api/intake, the Get started form. It checks the Turnstile token, saves
// the inquiry to Twenty (person, company, opportunity, note, task) and sends a
// push through ntfy that carries no personal details.
//
// Secrets (set in Cloudflare, never in this repo): TURNSTILE_SECRET,
// TWENTY_API_KEY, NTFY_TOPIC. Vars (wrangler.jsonc): TWENTY_API_URL,
// TWENTY_APP_URL, ALLOWED_ORIGINS.

const COUNTIES = ['Hillsborough', 'Pinellas', 'Pasco', 'Polk', 'Manatee', 'Other'];
const AMOUNTS = ['Under $500K', '$500K to $1M', '$1M to $2M', '$2M to $5M', '$5M to $10M', 'Not sure'];
const USES = ['Equipment', 'Building', 'Working capital', 'Expansion', 'Buying a business', 'Refinancing', 'Not sure'];
const FREE_MAIL = new Set(['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'me.com', 'live.com', 'msn.com', 'comcast.net', 'att.net', 'verizon.net', 'protonmail.com', 'proton.me']);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BODY = 16 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/intake') {
      if (request.method !== 'POST') return json({ ok: false, error: 'Use POST.' }, 405, { Allow: 'POST' });
      return handleIntake(request, env, ctx);
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false, error: 'Not found.' }, 404);
    return env.ASSETS.fetch(request);
  }
};

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extra
    }
  });
}

const TRY_AGAIN = 'Your details didn’t send. Try again, or email jack@cypressgrove.partners.';

async function handleIntake(request, env, ctx) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  if (!allowed.includes(origin)) return json({ ok: false, error: TRY_AGAIN }, 403);

  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    return json({ ok: false, error: TRY_AGAIN }, 415);
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'That’s more than the form can take. Shorten the last box and send again.' }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ ok: false, error: TRY_AGAIN }, 400); }

  // Bots fill the hidden field; accept quietly and drop it
  if (str(body.website)) return json({ ok: true });

  const form = clean(body);
  const problem = validate(form);
  if (problem) return json({ ok: false, error: problem }, 400);

  const human = await verifyTurnstile(env, str(body['cf-turnstile-response']), request.headers.get('CF-Connecting-IP'));
  if (!human) return json({ ok: false, error: 'The spam check didn’t pass. Refresh the page and send again.' }, 400);

  try {
    await saveToTwenty(env, form);
  } catch (err) {
    console.log('intake: Twenty save failed', err && err.message);
    ctx.waitUntil(push(env, 'Website inquiry failed to save', 'Someone sent the Get started form, but it did not reach Twenty. Check the Worker logs.', 'warning'));
    return json({ ok: false, error: TRY_AGAIN }, 502);
  }

  ctx.waitUntil(push(env, 'New website inquiry', 'Someone sent the Get started form. Open Twenty to see it.', 'seedling'));
  return json({ ok: true });
}

function str(v, max = 200) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function clean(b) {
  return {
    name: str(b.name, 120),
    email: str(b.email, 200).toLowerCase(),
    phone: str(b.phone, 40),
    company: str(b.company, 160),
    makes: str(b.makes, 200),
    county: str(b.county, 40),
    amount: str(b.amount, 40),
    use: str(b.use, 40),
    notes: str(b.notes, 2000)
  };
}

function validate(f) {
  if (!f.name) return 'Enter your name.';
  if (!EMAIL.test(f.email)) return 'Enter an email address like name@company.com.';
  if (!f.company) return 'Enter your company name.';
  if (!f.makes) return 'Tell us briefly what your shop makes.';
  if (!COUNTIES.includes(f.county)) return 'Choose a county.';
  if (f.amount && !AMOUNTS.includes(f.amount)) return 'Choose an amount from the list.';
  if (f.use && !USES.includes(f.use)) return 'Choose what the financing is for from the list.';
  return '';
}

async function verifyTurnstile(env, token, ip) {
  if (!token || !env.TURNSTILE_SECRET) return false;
  const data = new FormData();
  data.append('secret', env.TURNSTILE_SECRET);
  data.append('response', token);
  if (ip) data.append('remoteip', ip);
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: data });
    const out = await res.json();
    return out.success === true;
  } catch (err) {
    console.log('intake: Turnstile check failed', err && err.message);
    return false;
  }
}

/* ---------- Twenty ---------- */

async function twenty(env, method, path, body) {
  const res = await fetch(env.TWENTY_API_URL.replace(/\/$/, '') + '/rest/' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.TWENTY_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      // Cloudflare in front of Twenty refuses requests without a real User-Agent (error 1010)
      'User-Agent': 'cypressgrove-website/1.0 (+https://cypressgrove.partners)'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) throw new Error(method + ' ' + path.split('?')[0] + ' ' + res.status + ' ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

// Twenty wraps results as { data: { createPerson: {...} } } or { data: { people: [...] } }
function record(out) {
  const v = out && out.data ? Object.values(out.data)[0] : null;
  return Array.isArray(v) ? v[0] || null : v;
}

function splitName(full) {
  const parts = full.split(/\s+/);
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

function phoneFields(phone) {
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return { primaryPhoneNumber: digits, primaryPhoneCountryCode: 'US', primaryPhoneCallingCode: '+1' };
}

// Next weekday at 14:00 UTC (9 or 10 in the morning in Tampa)
function nextBusinessDay(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 14));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString();
}

function summary(f) {
  return [
    '**Website inquiry** (Get started form)',
    '',
    '- Name: ' + f.name,
    '- Email: ' + f.email,
    '- Phone: ' + (f.phone || 'not given'),
    '- Company: ' + f.company,
    '- Makes: ' + f.makes,
    '- County: ' + f.county,
    '- Amount: ' + (f.amount || 'not given'),
    '- For: ' + (f.use || 'not given'),
    '',
    f.notes ? 'Notes: ' + f.notes : 'No notes.'
  ].join('\n');
}

// Create a record, retrying once without the optional fields if Twenty rejects them
async function create(env, path, body, optionalKeys = []) {
  try {
    return record(await twenty(env, 'POST', path, body));
  } catch (err) {
    if (!optionalKeys.some((k) => k in body)) throw err;
    const lean = { ...body };
    optionalKeys.forEach((k) => delete lean[k]);
    console.log('intake: retrying ' + path + ' without ' + optionalKeys.join(', '));
    return record(await twenty(env, 'POST', path, lean));
  }
}

async function saveToTwenty(env, f) {
  const domain = f.email.split('@')[1];

  // Reuse the person if this email is already in Twenty
  const filter = encodeURIComponent('emails.primaryEmail[eq]:"' + f.email.replace(/"/g, '') + '"');
  const existing = record(await twenty(env, 'GET', 'people?limit=1&filter=' + filter));

  let companyId = existing && existing.companyId;
  if (!companyId) {
    // county and relationshipType are this workspace's custom fields (select values are upper case)
    const company = { name: f.company, county: f.county.toUpperCase(), relationshipType: ['BORROWER'] };
    if (!FREE_MAIL.has(domain)) company.domainName = { primaryLinkUrl: 'https://' + domain };
    companyId = (await create(env, 'companies', company, ['domainName', 'county', 'relationshipType'])).id;
  }

  let personId = existing && existing.id;
  if (!personId) {
    const person = { name: splitName(f.name), emails: { primaryEmail: f.email }, companyId, typeCustom: 'BORROWER' };
    const phones = phoneFields(f.phone);
    if (phones) person.phones = phones;
    personId = (await create(env, 'people', person, ['phones', 'typeCustom'])).id;
  }

  // The person is saved; the rest is best effort so one failure doesn't lose the lead
  const details = summary(f);
  const steps = [];
  let opportunityId = null;
  try {
    opportunityId = (await create(env, 'opportunities', { name: 'Website inquiry: ' + f.company, stage: 'LEAD', companyId, pointOfContactId: personId }, ['stage'])).id;
  } catch (err) { steps.push(err.message); }

  const targets = { targetPersonId: personId, targetCompanyId: companyId };
  if (opportunityId) targets.targetOpportunityId = opportunityId;

  try {
    const note = await withBody(env, 'notes', { title: 'Website inquiry' }, details);
    await linkAll(env, 'noteTargets', 'noteId', note.id, targets);
  } catch (err) { steps.push(err.message); }

  try {
    const task = await withBody(env, 'tasks', {
      title: 'Respond to website inquiry: ' + f.company,
      dueAt: nextBusinessDay(),
      status: 'TODO'
    }, details);
    await linkAll(env, 'taskTargets', 'taskId', task.id, targets);
  } catch (err) { steps.push(err.message); }

  if (steps.length) console.log('intake: saved the person, but some steps failed: ' + steps.join(' | '));
}

// Notes and tasks take rich text as bodyV2 in current Twenty; older workspaces use body
async function withBody(env, path, fields, markdown) {
  try {
    return record(await twenty(env, 'POST', path, { ...fields, bodyV2: { markdown } }));
  } catch (err) {
    console.log('intake: retrying ' + path + ' with body instead of bodyV2');
    return record(await twenty(env, 'POST', path, { ...fields, body: markdown }));
  }
}

async function linkAll(env, path, key, id, targets) {
  for (const [field, value] of Object.entries(targets)) {
    await twenty(env, 'POST', path, { [key]: id, [field]: value });
  }
}

/* ---------- Push ---------- */

async function push(env, title, message, tag) {
  if (!env.NTFY_TOPIC) return;
  try {
    await fetch('https://ntfy.sh/' + env.NTFY_TOPIC, {
      method: 'POST',
      body: message,
      headers: { Title: title, Tags: tag, Click: env.TWENTY_APP_URL || 'https://app.twenty.com' }
    });
  } catch (err) {
    console.log('intake: push failed', err && err.message);
  }
}

export { clean, validate, phoneFields, nextBusinessDay, summary };
