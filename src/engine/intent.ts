import type { BuildRequest, BuildPlanStep } from './types';

export function createInitialPlan(request: BuildRequest): BuildPlanStep[] {
  const text = request.message.toLowerCase();
  const steps: BuildPlanStep[] = [
    { id: 'understand', title: 'Understand request', detail: 'Interpret the product and constraints.', status: 'pending' },
    { id: 'plan', title: 'Create build plan', detail: 'Choose architecture, screens, data and integrations.', status: 'pending' },
    { id: 'build', title: 'Build', detail: 'Generate and update project files.', status: 'pending' },
    { id: 'test', title: 'Test', detail: 'Run the build and validate the result.', status: 'pending' },
  ];

  if (text.includes('supabase')) steps.push({ id: 'supabase', title: 'Configure Supabase', detail: 'Prepare the requested database/backend integration.', status: 'pending' });
  if (text.includes('vercel') || text.includes('deploy')) steps.push({ id: 'deploy', title: 'Deploy', detail: 'Prepare the production deployment.', status: 'pending' });
  return steps;
}

export function summarizeRequest(message: string) {
  const normalized = message.trim().replace(/\s+/g, ' ');
  return normalized.length > 180 ? `${normalized.slice(0, 177)}...` : normalized;
}
