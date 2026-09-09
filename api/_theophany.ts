export type TheophanyMemory = { id: string; session_id: string; kind: string; content: string; metadata: any; importance: number; created_at: string; updated_at: string };
const sqlText = (value: string) => `'${value.replace(/'/g, "''")}'`;
export async function supabaseQuery<T = any>(query: string): Promise<T> {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const projectRef = process.env.SUPABASE_PROJECT_REF;
  if (!token || !projectRef) throw new Error('Supabase provisioning requires SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF.');
  const response = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(projectRef)}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  if (!response.ok) throw new Error(`Supabase query failed (${response.status}).`);
  return response.json().catch(() => [] as T);
}
export async function getMemories(sessionId: string, limit = 12): Promise<TheophanyMemory[]> {
  const safeLimit = Math.min(Math.max(limit, 1), 50);
  return supabaseQuery<TheophanyMemory[]>(`select id,session_id,kind,content,metadata,importance,created_at,updated_at from public.theophany_memories where session_id=${sqlText(sessionId)} order by importance desc, updated_at desc limit ${safeLimit};`);
}
export async function saveMemory(sessionId: string, content: string, kind = 'context', importance = 5, metadata: Record<string, any> = {}) {
  if (!content.trim()) return;
  const safeImportance = Math.min(Math.max(importance, 1), 10);
  const meta = JSON.stringify(metadata).replace(/'/g, "''");
  await supabaseQuery(`insert into public.theophany_memories(session_id,kind,content,importance,metadata) values (${sqlText(sessionId)},${sqlText(kind)},${sqlText(content.trim())},${safeImportance},'${meta}'::jsonb);`);
}
export function memoryContext(memories: TheophanyMemory[]) {
  if (!memories.length) return 'No previous memory is available for this session.';
  return memories.map(m => `- [${m.kind}] ${m.content}`).join('\n');
}
export { sqlText };
