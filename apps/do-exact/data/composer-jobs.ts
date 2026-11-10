import type { Result, Sources } from '../app.contract.d.ts';
import type { JobSummary } from '../protocol/jobs.ts';
import { current, get, NOBODY, post, reply, seg } from './api.ts';

export const composerJobSources: Pick<Sources, 'loadComposerJobs' | 'stopComposerJob'> = {
  loadComposerJobs: async ([owner, agentId, chatId], store): Promise<Result<'loadComposerJobs'>> => {
    if (!current(owner, store) || agentId === '' || chatId === '') return { owner: NOBODY, agentId: '', jobs: [] };
    const { jobs } = await get<{ jobs: JobSummary[] }>(store, `/api/agents/${seg(agentId)}/jobs`);
    const running = jobs.filter(j => j.status === 'running' && j.chatId === chatId);
    return { owner, agentId, jobs: await Promise.all(running.map(async j => {
      const { output } = await get<{ output: string }>(store, `/api/agents/${seg(agentId)}/jobs/${seg(j.id)}/output`);
      return { id: j.id, command: j.command.split('\n')[0] ?? j.command, computer: j.computer, started: j.startedAt, output: output.slice(-32 * 1024).trimEnd().split('\n').slice(-40).join('\n') };
    })) };
  },
  stopComposerJob: ([agentId, id], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/jobs/${seg(id)}/stop`)),
};
