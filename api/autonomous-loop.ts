import { sqlText, supabaseQuery } from '../lib/theophany.js';

const CRON_SECRET = process.env.CRON_SECRET || '';
const MAX_ACTIVE = 1;

async function ensureTables() {
  await supabaseQuery(`create table if not exists public.theophany_autonomous_goals (
    id uuid primary key default gen_random_uuid(),
    session_id text not null,
    goal text not null,
    status text not null default 'queued',
    priority integer not null default 100,
    attempts integer not null default 0,
    max_attempts integer not null default 3,
    automation_job_id uuid,
    last_error text,
    created_at timestamptz not null default now(),
    started_at timestamptz,
    completed_at timestamptz,
    updated_at timestamptz not null default now()
  );`);
  await supabaseQuery(`create index if not exists theophany_autonomous_goals_queue_idx on public.theophany_autonomous_goals(status, priority, created_at);`);
}

async function activeCount() {
  const rows:any = await supabaseQuery(`select count(*)::int as count from public.theophany_autonomous_goals where status='running';`);
  return Number(Array.isArray(rows) ? rows[0]?.count : rows?.count || 0);
}

async function claimGoal() {
  const rows:any = await supabaseQuery(`update public.theophany_autonomous_goals set status='running', attempts=attempts+1, started_at=now(), updated_at=now() where id = (
    select id from public.theophany_autonomous_goals where status='queued' and attempts < max_attempts order by priority asc, created_at asc limit 1
  ) returning id,session_id,goal,attempts,max_attempts;`);
  return Array.isArray(rows) ? rows[0] : rows?.result?.[0];
}

async function finish(id:string,status:string,error?:string,jobId?:string) {
  await supabaseQuery(`update public.theophany_autonomous_goals set status=${sqlText(status)}, automation_job_id=${jobId ? sqlText(jobId) : 'automation_job_id'}, last_error=${error ? sqlText(error.slice(0,2000)) : 'null'}, completed_at=${status === 'completed' || status === 'failed' ? 'now()' : 'completed_at'}, updated_at=now() where id=${sqlText(id)};`);
}

function authorized(req:any) {
  if (!CRON_SECRET) return true;
  const header = String(req.headers?.authorization || '');
  return header === `Bearer ${CRON_SECRET}`;
}

export default async function handler(req:any,res:any) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ok:false,message:'Method not allowed'});
  if (!authorized(req)) return res.status(401).json({ok:false,message:'Unauthorized'});
  try {
    await ensureTables();

    if (req.method === 'POST') {
      const sessionId=String(req.body?.session_id || 'system').trim();
      const goal=String(req.body?.goal || '').trim();
      if (!goal) return res.status(400).json({ok:false,message:'goal is required.'});
      const priority=Math.max(1,Math.min(1000,Number(req.body?.priority)||100));
      const rows:any=await supabaseQuery(`insert into public.theophany_autonomous_goals(session_id,goal,priority) values (${sqlText(sessionId)},${sqlText(goal)},${priority}) returning id,session_id,goal,status,priority,created_at;`);
      return res.status(202).json({ok:true,goal:Array.isArray(rows)?rows[0]:rows?.result?.[0]});
    }

    if (await activeCount() >= MAX_ACTIVE) return res.status(200).json({ok:true,action:'idle',message:'An autonomous goal is already running.'});
    const goal=await claimGoal();
    if (!goal) return res.status(200).json({ok:true,action:'idle',message:'No queued autonomous goals.'});

    const origin=`${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'theophany.vercel.app'}`;
    try {
      const response=await fetch(`${origin}/api/automation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal:goal.goal,session_id:goal.session_id})});
      const data:any=await response.json().catch(()=>({}));
      if (!response.ok || !data.ok) throw new Error(data.message || 'Autonomous execution failed.');
      await finish(goal.id,'completed',undefined,data.job_id);
      return res.status(200).json({ok:true,action:'completed',goal_id:goal.id,job_id:data.job_id});
    } catch (error:any) {
      const message=error?.message || 'Autonomous execution failed.';
      const nextStatus=goal.attempts >= goal.max_attempts ? 'failed' : 'queued';
      await finish(goal.id,nextStatus,message);
      return res.status(nextStatus==='failed'?500:200).json({ok:nextStatus!=='failed',action:nextStatus,goal_id:goal.id,message});
    }
  } catch (error:any) {
    return res.status(500).json({ok:false,message:error?.message || 'Autonomous supervisor failed.'});
  }
}
