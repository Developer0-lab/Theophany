import { createBuildPlan, type BuildPlan, type BuildRequest, type BuildStage } from './buildPlan';

export type BuildSession = {
  id: string;
  request: BuildRequest;
  plan: BuildPlan;
  stage: BuildStage;
  completedTasks: string[];
  errors: string[];
};

export function startBuildSession(request: BuildRequest): BuildSession {
  return {
    id: crypto.randomUUID(),
    request,
    plan: createBuildPlan(request),
    stage: 'plan',
    completedTasks: [],
    errors: [],
  };
}

export function advanceBuildSession(session: BuildSession, stage: BuildStage): BuildSession {
  return { ...session, stage };
}
