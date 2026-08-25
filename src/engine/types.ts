export type BuildStage = 'understanding' | 'planning' | 'building' | 'testing' | 'repairing' | 'deploying' | 'complete' | 'failed';

export interface BuildRequest {
  message: string;
  projectId?: string;
  integrations?: { github?: boolean; vercel?: boolean; supabase?: boolean };
}

export interface BuildPlanStep {
  id: string;
  title: string;
  detail: string;
  status: 'pending' | 'running' | 'done' | 'failed';
}

export interface BuildSession {
  id: string;
  request: BuildRequest;
  stage: BuildStage;
  steps: BuildPlanStep[];
  output?: string;
  error?: string;
}
