import { randomBytes } from 'node:crypto';
import { sqlText, supabaseQuery } from '../theophany';

export async function ensureIntegrationTables() {
  await supabaseQuery(`create extension if not exists pgcrypto; create table if not exists public.theophany_integrations (id uuid primary key default gen_random_uuid(), session_id text not null, provider text not null, status text not null default 'connected', access_token text, refresh_token text, expires_at timestamptz, scopes text[] default '{}', metadata jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), unique(session_id,provider)); create table if not exists public.theophany_oauth_states (state text primary key, session_id text not null, provider text not null, expires_at timestamptz not null);`);
}

function encryptionKey() {
  const key = process.env.THEOPHANY_TOKEN_ENCRYPTION_KEY;
  if (!key) throw new Error('THEOPHANY_TOKEN_ENCRYPTION_KEY is not configured.');
  return key;
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
  const key = encryptionKey();
  const access = sqlText(tokens.accessToken);
  const refresh = tokens.refreshToken ? sqlText(tokens.refreshToken) : 'null';
  const expires = tokens.expiresAt ? sqlText(tokens.expiresAt) : 'null';
  const scopes = sqlText(`{${(tokens.scopes || []).map(s => s.replace(/[{}",\\]/g, '')).join(',')}}`);
  const metadata = sqlText(JSON.stringify(tokens.metadata || {}));
  await supabaseQuery(`insert into public.theophany_integrations(session_id,provider,status,access_token,refresh_token,expires_at,scopes,metadata) values (${sqlText(sessionId)},${sqlText(provider)},'connected',pgp_sym_encrypt(${access},${sqlText(key)}),${tokens.refreshToken ? `pgp_sym_encrypt(${refresh},${sqlText(key)})` : 'null'},${expires},${scopes}::text[] ,${metadata}::jsonb) on conflict(session_id,provider) do update set status='connected',access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,scopes=excluded.scopes,metadata=excluded.metadata,updated_at=now();`);
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
