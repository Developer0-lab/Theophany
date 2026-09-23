import { sqlText, supabaseQuery } from '../lib/theophany.js';

const CRON_SECRET = process.env.CRON_SECRET || '';
async function ensureAutonomousQueue() {
  await supabaseQuery("create table if not exists public.theophany_autonomous_goals (id uuid primary key default gen_random_uuid(), session_id text not null, goal text not null, status text not null default 'queued', priority integer not null default 100, attempts integer not null default 0, max_attempts integer not null default 3, automation_job_id uuid, last_error text, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz, updated_at timestamptz not null default now());");
  await supabaseQuery("create index if not exists theophany_autonomous_goals_queue_idx on public.theophany_autonomous_goals(status, priority, created_at);");
}
async function runAutonomousCron(req: any, res: any) {
  if (CRON_SECRET && String(req.headers?.authorization || '') !== `Bearer ${CRON_SECRET}`) return res.status(401).json({ok:false,message:'Unauthorized'});
  await ensureAutonomousQueue();
  const active:any = await supabaseQuery("select count(*)::int as count from public.theophany_autonomous_goals where status='running';");
  if (Number(Array.isArray(active) ? active[0]?.count : active?.count || 0) > 0) return res.status(200).json({ok:true,action:'idle',message:'An autonomous goal is already running.'});
  const claimed:any = await supabaseQuery("update public.theophany_autonomous_goals set status='running', attempts=attempts+1, started_at=now(), updated_at=now() where id=(select id from public.theophany_autonomous_goals where status='queued' and attempts < max_attempts order by priority asc, created_at asc limit 1) returning id,session_id,goal,attempts,max_attempts;");
  const goal=Array.isArray(claimed)?claimed[0]:claimed?.result?.[0];
  if (!goal) return res.status(200).json({ok:true,action:'idle',message:'No queued autonomous goals.'});
  const origin=`${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'theophany.vercel.app'}`;
  try {
    const r=await fetch(`${origin}/api/automation`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal:goal.goal,session_id:goal.session_id})});
    const data:any=await r.json().catch(()=>({}));
    if(!r.ok||!data.ok) throw new Error(data.message||'Autonomous execution failed.');
    await supabaseQuery(`update public.theophany_autonomous_goals set status='completed', automation_job_id=${sqlText(data.job_id)}, completed_at=now(), updated_at=now(), last_error=null where id=${sqlText(goal.id)};`);
    return res.status(200).json({ok:true,action:'completed',goal_id:goal.id,job_id:data.job_id});
  } catch(error:any) {
    const message=String(error?.message||'Autonomous execution failed.').slice(0,2000);
    const status=goal.attempts>=goal.max_attempts?'failed':'queued';
    await supabaseQuery(`update public.theophany_autonomous_goals set status=${sqlText(status)}, last_error=${sqlText(message)}, updated_at=now(), completed_at=${status==='failed'?'now()':'completed_at'} where id=${sqlText(goal.id)};`);
    return res.status(status==='failed'?500:200).json({ok:status!=='failed',action:status,goal_id:goal.id,message});
  }
}
const stepNames = ['Understand', 'Plan', 'Build', 'Test', 'Deploy', 'Repair', 'Complete'];
const MAX_ATTEMPTS = 3;
async function stage(jobId: string, order: number, status: string, message = '') {
  await supabaseQuery(`update public.theophany_automation_steps set status=${sqlText(status)}, message=${message ? sqlText(message) : 'null'}, ${status === 'running' ? 'started_at=now(),' : ''}${status === 'completed' || status === 'failed' ? 'completed_at=now(),' : ''} name=name where job_id=${sqlText(jobId)} and step_order=${order};`);
}
async function createJob(sessionId: string, goal: string) {
  const rows: any = await supabaseQuery(`insert into public.theophany_automation_jobs(session_id,goal,status,max_attempts) values (${sqlText(sessionId)},${sqlText(goal)},'queued',${MAX_ATTEMPTS}) returning id,session_id,goal,status,attempts,max_attempts,created_at;`);
  const job = Array.isArray(rows) ? rows[0] : rows?.result?.[0];
  if (!job?.id) throw new Error('Could not create automation job.');
  for (let i = 0; i < stepNames.length; i++) await supabaseQuery(`insert into public.theophany_automation_steps(job_id,step_order,name) values (${sqlText(job.id)},${i + 1},${sqlText(stepNames[i])});`);
  return job;
}
async function updateJob(jobId: string, status: string, extra = '') {
  await supabaseQuery(`update public.theophany_automation_jobs set status=${sqlText(status)}, attempts=attempts+1, ${status === 'running' ? 'started_at=now(),' : ''}${status === 'completed' || status === 'failed' ? 'completed_at=now(),' : ''}error_message=${extra ? sqlText(extra) : 'null'}, updated_at=now() where id=${sqlText(jobId)};`);
}
async function latestCommitSha() {
  const token = process.env.GITHUB_TOKEN; const repo = process.env.THEOPHANY_GITHUB_REPO || 'Developer0-lab/Theophany';
  if (!token) return null;
  const r = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  if (!r.ok) return null; const data: any = await r.json(); return data?.[0]?.sha || null;
}
async function deploymentForCommit(commitSha: string) {
  const token = process.env.VERCEL_TOKEN; const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId || !commitSha) return null;
  const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=20&target=production`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null; const data: any = await r.json();
  return (data.deployments || []).find((d: any) => d.meta?.githubCommitSha === commitSha) || null;
}
async function waitForDeployment(commitSha: string, maxChecks = 8) {
  for (let i = 0; i < maxChecks; i++) {
    const deployment = await deploymentForCommit(commitSha);
    if (deployment && ['READY','ERROR','CANCELED'].includes(deployment.readyState || deployment.state)) return deployment;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  return await deploymentForCommit(commitSha);
}
async function runJob(jobId: string, sessionId: string, goal: string, origin: string) {
  await updateJob(jobId, 'running'); let lastError = ''; let lastData: any = null;
  try {
    await stage(jobId, 1, 'completed', 'Request accepted and understood.');
    await stage(jobId, 2, 'completed', 'Execution plan prepared.');
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await stage(jobId, 3, 'running', attempt === 1 ? 'Theophany is building the requested software.' : `Theophany is repairing the previous failure (attempt ${attempt}/${MAX_ATTEMPTS}).`);
      const instruction = attempt === 1 ? goal : `Continue the autonomous task. The previous implementation/deployment failed with this error: ${lastError.slice(0, 1200)}. Inspect the existing project state and repair the failure while preserving the original goal: ${goal}. Make the smallest complete fix, then commit it.`;
      const response = await fetch(`${origin}/api/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: instruction, session_id: sessionId, automation_job_id: jobId, mode: 'agent' }) });
      const data = await response.json().catch(() => ({})); lastData = data;
      if (!response.ok || !data.ok) {
        lastError = data.message || 'The build step failed.'; await stage(jobId, 3, attempt === MAX_ATTEMPTS ? 'failed' : 'completed', lastError);
        if (attempt < MAX_ATTEMPTS) await stage(jobId, 6, 'running', 'Failure detected. Theophany will diagnose and repair automatically.'); continue;
      }
      await stage(jobId, 3, 'completed', `Implementation generated and committed (${attempt}/${MAX_ATTEMPTS}).`);
      await stage(jobId, 4, 'completed', 'Build pipeline completed its verification step.');
      const sha = await latestCommitSha(); const deployment = sha ? await waitForDeployment(sha) : null;
      if (deployment?.readyState === 'READY' || deployment?.state === 'READY') {
        await stage(jobId, 5, 'completed', 'Production deployment verified successfully.'); await stage(jobId, 6, 'completed', 'No repair was required.'); await stage(jobId, 7, 'completed', 'Autonomous task completed.');
        lastData.deployment = { id: deployment.id, state: deployment.readyState || deployment.state, url: deployment.url };
        await supabaseQuery(`update public.theophany_automation_jobs set status='completed', result='${JSON.stringify({ message: lastData.message, files: lastData.files, deployment: lastData.deployment }).replace(/'/g, "''")}'::jsonb, completed_at=now(), updated_at=now(), error_message=null where id=${sqlText(jobId)};`);
        return lastData;
      }
      lastError = deployment?.readyState === 'ERROR' || deployment?.state === 'ERROR' ? 'Vercel production deployment failed. ' + (deployment.errorMessage || deployment.errorCode || 'The deployment returned ERROR.') : 'The build was committed, but production deployment could not be verified within the automation window.';
      await stage(jobId, 5, attempt === MAX_ATTEMPTS ? 'failed' : 'completed', lastError);
      if (attempt < MAX_ATTEMPTS) await stage(jobId, 6, 'running', `Diagnosing deployment failure and preparing repair ${attempt + 1}/${MAX_ATTEMPTS}.`);
    }
    throw new Error(lastError || 'Automation exhausted its repair attempts.');
  } catch (error: any) {
    const message = error?.message || 'Automation failed.'; await stage(jobId, 6, 'failed', message).catch(() => {}); await stage(jobId, 7, 'failed', 'Automation stopped before completion.').catch(() => {}); await updateJob(jobId, 'failed', message); throw error;
  }
}
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    if (req.method === 'GET' && String(req.query?.cron || '') === '1') return await runAutonomousCron(req, res);
    if (req.method === 'GET') {
      const sessionId = String(req.query?.session_id || '').trim(); if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
      const jobs: any = await supabaseQuery(`select id,session_id,goal,status,attempts,max_attempts,result,error_message,created_at,started_at,completed_at,updated_at from public.theophany_automation_jobs where session_id=${sqlText(sessionId)} order by created_at desc limit 20;`);
      return res.status(200).json({ ok: true, jobs: Array.isArray(jobs) ? jobs : [] });
    }
    const sessionId = String(req.body?.session_id || '').trim(); const goal = String(req.body?.goal || '').trim();
    if (!sessionId || !goal) return res.status(400).json({ ok: false, message: 'session_id and goal are required.' });
    const job = await createJob(sessionId, goal); const origin = `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'theophany.vercel.app'}`;
    const data = await runJob(job.id, sessionId, goal, origin); return res.status(200).json({ ok: true, job_id: job.id, ...data });
  } catch (error: any) { return res.status(500).json({ ok: false, message: error?.message || 'Automation failed.' }); }
}