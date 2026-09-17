import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
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

function keyBytes() {
  const value = process.env.THEOPHANY_TOKEN_ENCRYPTION_KEY;
  if (!value) throw new Error('THEOPHANY_TOKEN_ENCRYPTION_KEY is not configured.');
  return createHash('sha256').update(value).digest();
}

function encryptToken(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${data.toString('base64url')}`;
}

function decryptToken(value: string) {
  const [version, ivText, tagText, dataText] = String(value).split(':');
  if (version !== 'v1' || !ivText || !tagText || !dataText) throw new Error('Invalid encrypted token.');
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(), Buffer.from(ivText, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8');
}

export async function saveOAuthState(sessionId: string, provider: string) {
  await ensureIntegrationTables();
  const state = randomBytes(32).toString('hex');
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
  const id = randomBytes(16).toString('hex');
  const access = encryptToken(tokens.accessToken);
  const refresh = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null;
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
