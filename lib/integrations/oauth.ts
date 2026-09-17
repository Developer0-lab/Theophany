import { sqlText, supabaseQuery } from '../theophany';

let tablesReady = false;

async function ensureIntegrationTables() {
  if (tablesReady) return;
  await supabaseQuery(`create table if not exists public.theophany_integrations (id text primary key, session_id text not null, provider text not null, status text not null default 'connected', access_token text, refresh_token text, expires_at timestamptz, scopes text[] not null default '{}', metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(session_id, provider));`);
  await supabaseQuery(`create table if not exists public.theophany_oauth_states (state text primary key, session_id text not null, provider text not null, expires_at timestamptz not null);`);
  await supabaseQuery(`alter table public.theophany_integrations enable row level security;`);
  await supabaseQuery(`alter table public.theophany_oauth_states enable row level security;`);
  tablesReady = true;
}

function secretValue() {
  const value = process.env.THEOPHANY_TOKEN_ENCRYPTION_KEY || process.env.SUPABASE_ACCESS_TOKEN;
  if (!value) throw new Error('A server-side token encryption secret is not configured.');
  return value;
}

function randomHex(bytes: number) {
  const data = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(data);
  return Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
}

function randomUuid() {
  const data = new Uint8Array(16);
  globalThis.crypto.getRandomValues(data);
  data[6] = (data[6] & 0x0f) | 0x40;
  data[8] = (data[8] & 0x3f) | 0x80;
  const h = Array.from(data, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function toBase64Url(data: Uint8Array) {
  return Buffer.from(data).toString('base64url');
}

function fromBase64Url(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

async function cryptoKey() {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(secretValue()));
  return globalThis.crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function encryptToken(value: string) {
  const iv = new Uint8Array(12);
  globalThis.crypto.getRandomValues(iv);
  const encrypted = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cryptoKey(), new TextEncoder().encode(value)));
  return `v1:${toBase64Url(iv)}:${toBase64Url(encrypted)}`;
}

async function decryptToken(value: string) {
  const [version, ivText, dataText] = String(value).split(':');
  if (version !== 'v1' || !ivText || !dataText) throw new Error('Invalid encrypted token.');
  const decrypted = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(ivText) }, await cryptoKey(), fromBase64Url(dataText));
  return new TextDecoder().decode(decrypted);
}

export async function saveOAuthState(sessionId: string, provider: string) {
  await ensureIntegrationTables();
  const state = randomHex(32);
  await supabaseQuery(`insert into public.theophany_oauth_states(state,session_id,provider,expires_at) values (${sqlText(state)},${sqlText(sessionId)},${sqlText(provider)},now()+interval '10 minutes');`);
  return state;
}

export async function consumeOAuthState(state: string, provider: string) {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery(`delete from public.theophany_oauth_states where state=${sqlText(state)} and provider=${sqlText(provider)} and expires_at>now() returning session_id;`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row?.session_id) throw new Error('OAuth state is invalid or expired.');
  return row.session_id as string;
}

export async function saveIntegration(sessionId: string, provider: string, tokens: { accessToken: string; refreshToken?: string; expiresAt?: string; scopes?: string[]; metadata?: any }) {
  await ensureIntegrationTables();
  const id = randomUuid();
  const access = await encryptToken(tokens.accessToken);
  const refresh = tokens.refreshToken ? await encryptToken(tokens.refreshToken) : null;
  const expires = tokens.expiresAt ? sqlText(tokens.expiresAt) : 'null';
  const scopes = sqlText(`{${(tokens.scopes || []).map(s => s.replace(/[{}",\\]/g, '')).join(',')}}`);
  const metadata = sqlText(JSON.stringify(tokens.metadata || {}));
  await supabaseQuery(`insert into public.theophany_integrations(id,session_id,provider,status,access_token,refresh_token,expires_at,scopes,metadata) values (${sqlText(id)},${sqlText(sessionId)},${sqlText(provider)},'connected',${sqlText(access)},${refresh ? sqlText(refresh) : 'null'},${expires},${scopes}::text[],${metadata}::jsonb) on conflict(session_id,provider) do update set status='connected',access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes,metadata=excluded.metadata,updated_at=now();`);
}

export async function getIntegrationStatuses(sessionId: string) {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery(`select provider,status,expires_at,scopes,metadata,updated_at from public.theophany_integrations where session_id=${sqlText(sessionId)} order by provider;`);
  return Array.isArray(rows) ? rows : [];
}

export async function disconnectIntegration(sessionId: string, provider: string) {
  await ensureIntegrationTables();
  await supabaseQuery(`delete from public.theophany_integrations where session_id=${sqlText(sessionId)} and provider=${sqlText(provider)};`);
}

export async function getIntegrationToken(sessionId: string, provider: string, kind: 'access' | 'refresh' = 'access') {
  await ensureIntegrationTables();
  const rows: any = await supabaseQuery(`select access_token,refresh_token from public.theophany_integrations where session_id=${sqlText(sessionId)} and provider=${sqlText(provider)} limit 1;`);
  const row = Array.isArray(rows) ? rows[0] : null;
  const value = kind === 'refresh' ? row?.refresh_token : row?.access_token;
  return value ? decryptToken(value) : null;
}
