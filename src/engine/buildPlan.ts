export type BuildStage = 'understand' | 'plan' | 'build' | 'test' | 'repair' | 'deploy' | 'complete' | 'failed';

export type BuildRequest = {
  text: string;
  projectName?: string;
};

export type BuildPlan = {
  summary: string;
  needsSupabase: boolean;
  needsVercel: boolean;
  tasks: string[];
};

export function createBuildPlan(request: BuildRequest): BuildPlan {
  const text = request.text.toLowerCase();
  const needsSupabase = /\bsupabase\b/.test(text);
  const needsVercel = /\bvercel\b|deploy|publish|go live/.test(text);

  const tasks = [
    'Understand the requested product and constraints',
    'Create an implementation plan',
    'Generate or modify the application source',
    'Validate the build and application behavior',
  ];

  if (needsSupabase) tasks.push('Configure the requested Supabase data/auth/storage requirements');
  if (needsVercel) tasks.push('Prepare and deploy the application to Vercel');

  tasks.push('Repair failures and re-validate before reporting completion');

  return {
    summary: request.text.trim(),
    needsSupabase,
    needsVercel,
    tasks,
  };
}
