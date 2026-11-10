import type { Result, Sources } from '../app.contract.d.ts';
import { jobOutcome, type JobSummary } from '../protocol/jobs.ts';
import { current, get, NOBODY, post, reply, seg } from './api.ts';

export const composerJobSources: Pick<Sources, 'loadComposerJobs' | 'stopComposerJob'> = {
  loadComposerJobs: async ([owner, agentId, chatId], store): Promise<Result<'loadComposerJobs'>> => {
    if (!current(owner, store) || agentId === '' || chatId === '') return { owner: NOBODY, agentId: '', jobs: [] };
    const { jobs } = await get<{ jobs: JobSummary[] }>(store, `/api/agents/${seg(agentId)}/jobs`);
    // What a running one of this chat printed, for the menu over the composer; every job's state,
    // for the chips in the transcript where each was started.
    return { owner, agentId, jobs: await Promise.all(jobs.map(async j => {
      const here = j.status === 'running' && j.chatId === chatId;
      const output = here ? (await get<{ output: string }>(store, `/api/agents/${seg(agentId)}/jobs/${seg(j.id)}/output`)).output : '';
      const ended = j.status === 'running' ? '' : jobOutcome({ ...j, ms: (j.endedAt ?? j.startedAt) - j.startedAt });
      return { id: j.id, command: j.command.split('\n')[0] ?? j.command, computer: j.computer, started: j.startedAt, output: output.slice(-32 * 1024).trimEnd().split('\n').slice(-40).join('\n'),
        status: j.status, chatId: j.chatId, ended: ended.charAt(0).toLowerCase() + ended.slice(1) };
    })) };
  },
  stopComposerJob: ([agentId, id], store) => reply(() => post(store, `/api/agents/${seg(agentId)}/jobs/${seg(id)}/stop`)),
};
