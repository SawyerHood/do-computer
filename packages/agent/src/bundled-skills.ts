/** Skills every new agent starts with. Kept short: each is read in full when loaded. */
export type BundledSkill = { name: string; description: string; body: string }

export const BUNDLED_SKILLS: readonly BundledSkill[] = [
  {
    name: "writing-skills",
    description:
      "How to write a skill that works. Load before creating or reworking a skill, including when the user asks you to remember how to do something.",
    body: `# Writing skills

A skill is instructions for your future self, who will not have this conversation. Write what that reader needs and nothing else.

## When to save one

- You worked out a procedure that took several steps or a correction from the user to get right.
- The user says "next time", "always", or "remember how to".
- Do not save one-off facts; those go in memory. Do not save what you would do correctly anyway.

## The description decides everything

Only the name and description are visible until the skill is loaded, so the description must say when to use it, in the words the request will arrive in.

- Weak: "Helps with reports."
- Strong: "Build the weekly sales report from the exported CSV. Use when asked for the weekly report, sales numbers, or the Monday summary."

## The body

1. Start with the goal in one sentence.
2. Give the steps in order, as commands or concrete actions, with the real names, paths and values.
3. Say what a correct result looks like, so you can check your work.
4. Record the mistakes you made on the way and how to avoid them. This is the most valuable part.

Keep it under a page. If it needs long reference material or a script, put that in a separate file with the skill tool's write_file action and point to it from the body.

## After saving

Use the skill the next time the task comes up. If it led you wrong, fix it with the patch action right then, while you know what was wrong.
`,
  },
  {
    name: "planning-automations",
    description:
      "How to set up a scheduled or repeating task well. Load when the user asks for something to happen later, regularly, every day or week, or as a reminder.",
    body: `# Planning automations

A scheduled run starts with no memory of this conversation. It sees only the prompt you save, your skills and your long-term memory. Nobody is there to answer questions.

## Before scheduling

- Settle the time and how often. Confirm the timezone when the time of day matters; a cron expression runs in the user's timezone unless you pass another.
- If the first run is not obvious ("every day at 9" asked at 9:05), say when it will first run.

## Writing the prompt

Write it as a complete brief to a capable stranger:

- what to do, with the exact names, files, addresses and sources involved,
- what the report should contain and how long it should be,
- when to stay silent. A run that replies with exactly [SILENT] sends nothing; say so in the prompt when the task is "tell me only if something changed".

If the task needs to compare with last time, say where to keep state, for example a file in the workspace, and tell the run to read and update it.

## Choosing the schedule

- "30m" or "2h": once, that long from now. Use for reminders.
- "every 2h": repeating, measured from when it was created.
- A cron expression such as "0 9 * * 1-5": a time of day or week.
- An ISO timestamp: once, at that moment.

## Afterwards

Tell the user what you scheduled and when it will first run. They can see and pause it under Automations.
`,
  },
]
