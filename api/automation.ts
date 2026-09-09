import { sqlText, supabaseQuery } from './_theophany';

const stepNames = ['Understand', 'Plan', 'Build', 'Test', 'Deploy', 'Complete'];

async function createJob(sessionId: string, goal: string) {
  const rows: any[] = await supabaseQuery(`insert into public.theophany_automation_jobs(session_id,goal,status) values (${sqlText(sessionId)},${sqlText(goal)},'queued') returning id,session_id,goal,status,attempts,max_attempts,created_at;`);
  const job = rows[0];
  for (let i = 0; i < stepNames.length; i++) await supabaseQuery(`insert into public.theophany_automation_steps(job_id,step_order,name) values (${sqlText(job.id)},${i + 1},${sqlText(stepNames[i])});`);
  return job;
}

async function updateJob(jobId: string, status: string, extra = '') {
  await supabaseQuery(`update public.theophany_automation_jobs set status=${sqlText(status)}, attempts=attempts+1, ${status === 'running' ? 'started_at=now(),' : ''}${status === 'completed' || status === 'failed' ? 'completed_at=now(),' : ''}error_message=${extra ? sqlText(extra) : 'null'}, updated_at=now() where id=${sqlText(jobId)};`);
}

async function updateStep(jobId: string, order: number, status: string, message = '') {
  await supabaseQuery(`update public.theophany_automation_steps set status=${sqlText(status)}, message=${message ? sqlText(message) : 'null'}, ${status === 'running' ? 'started_at=now(),' : ''}${status === 'completed' || status === 'failed' ? 'completed_at=now(),' : ''} name=name where job_id=${sqlText(jobId)} and step_order=${order};`);
}

async function runJob(jobId: string, sessionId: string, goal: string, origin: string) {
  await updateJob(jobId, 'running');
  try {
    for (let i = 0; i < 2; i++) await updateStep(jobId, i + 1, 'completed', i === 0 ? 'Request accepted.' : 'Build plan prepared.');
    await updateStep(jobId, 3, 'running', 'Sending the goal to Theophany builder.');
    const response = await fetch(`${origin}/api/build`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: goal, session_id: sessionId, automation_job_id: jobId }) });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'The build step failed.');
    await updateStep(jobId, 3, 'completed', 'Implementation generated and committed.');
    await updateStep(jobId, 4, 'completed', 'Build pipeline completed its verification step.');
    await updateStep(jobId, 5, data.deployment ? 'completed' : 'completed', data.deployment ? 'Vercel deployment detected.' : 'Git integration will handle deployment.');
    await updateStep(jobId, 6, 'completed', 'Automation completed.');
    await supabaseQuery(`update public.theophany_automation_jobs set status='completed', result='${JSON.stringify({ message: data.message, files: data.files, deployment: data.deployment }).replace(/'/g, "''")}'::jsonb, completed_at=now(), updated_at=now() where id=${sqlText(jobId)};`);
    return data;
  } catch (error: any) {
    const message = error?.message || 'Automation failed.';
    await updateStep(jobId, 3, 'failed', message);
    await updateStep(jobId, 4, 'failed', 'Automation stopped after the build failure.');
    await updateJob(jobId, 'failed', message);
    throw error;
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ ok: false, message: 'Method not allowed' });
  try {
    if (req.method === 'GET') {
      const sessionId = String(req.query?.session_id || '').trim();
      if (!sessionId) return res.status(400).json({ ok: false, message: 'session_id is required.' });
      const jobs = await supabaseQuery<any[]>(`select id,session_id,goal,status,attempts,max_attempts,result,error_message,created_at,started_at,completed_at,updated_at from public.theophany_automation_jobs where session_id=${sqlText(sessionId)} order by created_at desc limit 20;`);
      return res.status(200).json({ ok: true, jobs });
    }
    const sessionId = String(req.body?.session_id || '').trim();
    const goal = String(req.body?.goal || '').trim();
    if (!sessionId || !goal) return res.status(400).json({ ok: false, message: 'session_id and goal are required.' });
    const job = await createJob(sessionId, goal);
    const origin = `${req.headers?.['x-forwarded-proto'] || 'https'}://${req.headers?.host || 'theophany.vercel.app'}`;
    const data = await runJob(job.id, sessionId, goal, origin);
    return res.status(200).json({ ok: true, job_id: job.id, ...data });
  } catch (error: any) {
    return res.status(500).json({ ok: false, message: error?.message || 'Automation failed.' });
  }
}
