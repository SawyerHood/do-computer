/* ================================================================
   The demo's world: one agent, one conversation, and enough of the
   other pages to look lived in. Every label is the app's own wording.
   ================================================================ */
var DATA = (function () {
  'use strict';

  var agent = {
    name: 'Juniper',
    tagline: 'Keeps an eye on things',
    seed: 'jn3xhn',
    color: 'moss',
    hatchedOn: 'Aug 24',
    day: 41,
    model: 'anthropic/claude-sonnet-5.5',
    soul:
      'You are Juniper. You are calm, practical and a little dry.\n\n' +
      'Say what you found first and what you did about it second. Keep answers short unless asked for more. ' +
      'When something is broken, say so plainly and say what it would take to fix.\n\n' +
      'You look after a few machines and a lot of small recurring chores. Prefer checking to guessing: run the command, read the file, then answer. ' +
      'Ask before anything that deletes data or costs money.',
    user:
      'Time zone: America/Los_Angeles.\n' +
      'Wants the conclusion first, then the detail.\n' +
      'Home server is "workshop" (Debian, in the garage). Laptop is "fern".\n' +
      'The photo archive lives in /srv/photos on workshop.\n' +
      'Works Monday to Thursday. Fridays are for projects.\n' +
      'Vegetarian. Partner is allergic to walnuts.\n' +
      'Reads the weekly review on Sunday evening.\n' +
      'Does not want to be told when a scheduled check finds nothing.',
    memory:
      'workshop: restic repository at /mnt/vault/restic, nightly at 02:00 from a systemd timer (restic-backup.service).\n' +
      'Snapshot policy: keep 7 daily, 4 weekly, 12 monthly. Written down in backup-policy.md in the library.\n' +
      'workshop: SSH goes through the wrapper ssh-workshop.sh; key access was set up in September.\n' +
      'NAS fan controller firmware is 2.4.1. The loud fan curve is a known fault; a fix is promised in the next version.\n' +
      'Weekly review: Sunday 18:00, as a Markdown file in the library, three sections: done, slipped, next.\n' +
      'Lisbon trip: March 12 to 19. Flights are booked (confirmation in the library). No hotel yet; prefers Alfama or Graça.\n' +
      'Car registration renews in November. The form is in the library and needs the odometer reading.\n' +
      'Sourdough: the starter is fed at 8 in the morning; dough goes in the fridge by 9 at night.\n' +
      'Gift ideas for Dad are in gift-ideas.md. Budget is about 80 dollars.\n' +
      'Calendar connector is connected. The task tracker needs signing in again.\n' +
      'Tax documents: the checklist is in the library; two brokerage forms are still missing.\n' +
      'Subscriptions are tracked in subscriptions.csv; the streaming bundle renews on the 14th.\n' +
      'Prefers metric units and 24-hour times in anything written down.\n' +
      'fern is paired read-only: it can read ~/Documents and ~/Projects there, nothing else.\n' +
      'Passport expires next June; the photos were taken on October 1.\n' +
      'When a command needs sudo on workshop, say what it will change before running it.\n' +
      'Dentist is every six months; the next visit is not booked yet.'
  };
  var limits = { memory: 2200, user: 1375 };
  var MEMORY_ADD = '\nworkshop: the vault disk fills up. Prune now runs after every backup; check free space first if a backup fails.';

  var chats = [
    'Photo archive backup', 'Trip to Lisbon in March', 'Renewing the car registration', 'Weekly review notes',
    'Why the fan is so loud', 'Set up SSH key access', 'Gift ideas for Dad', 'Sourdough timing', 'Tax documents checklist'
  ];

  // ---- the conversation as it stands when the page opens ----
  var messages = [
    { role: 'user', at: '9:11 AM', text: 'Did last night’s backup of the photo archive run? It is the restic job on workshop.' },
    { role: 'agent', at: '9:12 AM', parts: [
      { html:
        '<p>It started, but it did not finish. The job began at 02:00 and stopped 41 minutes in:</p>' +
        '<pre><code>Fatal: unable to save snapshot: write /mnt/vault/restic/data/3f/tmp-481920:\nno space left on device</code></pre>' +
        '<p>The vault disk is <strong>97% full</strong>. Three things take up most of it:</p>' +
        '<table><thead><tr><th>Folder</th><th>Size</th></tr></thead><tbody>' +
        '<tr><td><code>restic/</code> (the snapshots)</td><td>1.4 TB</td></tr>' +
        '<tr><td><code>timelapse-raw/</code></td><td>212 GB</td></tr>' +
        '<tr><td><code>old-laptop-image/</code></td><td>118 GB</td></tr></tbody></table>' +
        '<p>The last complete snapshot is from <strong>Friday at 02:00</strong>, so nothing is lost yet. I can prune old snapshots: keeping 7 daily, 4 weekly and 12 monthly would free about 380 GB. Want me to?</p>' }
    ] },
    { role: 'user', at: '9:14 AM', text: 'Yes, prune it. And write the policy down so we do not have to work it out again.' },
    { role: 'agent', at: '9:31 AM', parts: [
      { html:
        '<p>Done. I removed 63 old snapshots, and the vault is down to <strong>76%</strong> with 431 GB free.</p>' +
        '<p>The policy is in a file, and the backup script now runs the same prune after every backup:</p>' },
      { file: { name: 'backup-policy.md', size: '1.2 KB', ext: 'md' } },
      { html: '<p>Last night’s backup still has not run. Say the word and I will start it.</p>' }
    ] }
  ];

  var log = [
    { title: 'Checked last night’s backup', outcome: 'It failed 41 minutes in: the vault disk is 97% full', at: '9:12 AM', steps: [
      { kind: 'command', text: 'Ran on workshop: systemctl status restic-backup.service',
        out: '× restic-backup.service - Nightly restic backup of /srv/photos\n     Loaded: loaded (/etc/systemd/system/restic-backup.service; static)\n     Active: failed (Result: exit-code) since Sat 2026-10-03 02:41:17 PDT\n    Process: 48213 ExecStart=/usr/local/bin/restic-backup.sh (code=exited, status=1/FAILURE)' },
      { kind: 'command', text: 'Ran on workshop: journalctl -u restic-backup.service --since yesterday -n 20',
        out: 'Oct 03 02:00:04 workshop restic-backup.sh[48213]: open repository\nOct 03 02:00:09 workshop restic-backup.sh[48213]: using parent snapshot 5e1c9a02\nOct 03 02:41:17 workshop restic-backup.sh[48213]: Fatal: unable to save snapshot: write /mnt/vault/restic/data/3f/tmp-481920: no space left on device' },
      { kind: 'command', text: 'Ran on workshop: df -h /mnt/vault',
        out: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sdb1       1.8T  1.7T   55G  97% /mnt/vault' },
      { kind: 'command', text: 'Ran on workshop: du -sh /mnt/vault/*',
        out: '118G\t/mnt/vault/old-laptop-image\n1.4T\t/mnt/vault/restic\n212G\t/mnt/vault/timelapse-raw' },
      { kind: 'search', text: 'Searched the web: restic forget keep-daily keep-weekly keep-monthly',
        out: 'restic.readthedocs.io · Removing backup snapshots\nforum.restic.net · A sensible retention policy for a home server' }
    ] },
    { title: 'Pruned old snapshots', outcome: 'Removed 63 snapshots, freed 376 GB and wrote the policy down', at: '9:31 AM', steps: [
      { kind: 'command', text: 'Ran on workshop: restic -r /mnt/vault/restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune',
        out: 'Applying Policy: keep 7 daily, 4 weekly, 12 monthly snapshots\nkeep 23 snapshots, remove 63 snapshots\n[14:02] 100.00%  63 / 63 files deleted\ntotal prune: 51208 blobs / 376.4 GiB' },
      { kind: 'command', text: 'Ran on workshop: df -h /mnt/vault',
        out: 'Filesystem      Size  Used Avail Use% Mounted on\n/dev/sdb1       1.8T  1.4T  431G  76% /mnt/vault' },
      { kind: 'file', text: 'Wrote backup-policy.md', out: '' },
      { kind: 'file', text: 'Edited restic-backup.sh on workshop',
        out: '+ restic -r "$REPO" forget --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune' },
      { kind: 'file', text: 'Sent you backup-policy.md', out: '' },
      { kind: 'memory', text: 'Updated its memory', out: 'Snapshot policy: keep 7 daily, 4 weekly, 12 monthly. Written down in backup-policy.md in the library.' }
    ] }
  ];

  // ---- the conversation the page plays ----
  var CHECK_PROMPT = 'Look at the last run of restic-backup on workshop. If it finished cleanly, say nothing. If it failed or did not start, tell me the error.';
  var script = {
    ask: 'Great. Start last night’s backup again now, and check it every morning at 8. Only tell me if it failed.',
    at: '9:34 AM',
    steps: [
      { think: 1900 },
      { tool: { kind: 'command', doing: 'Running on workshop: sudo systemctl start restic-backup.service', did: 'Ran on workshop: sudo systemctl start restic-backup.service', out: '' }, ms: 3000 },
      { tool: { kind: 'command', doing: 'Running on workshop: journalctl -u restic-backup.service -n 3', did: 'Ran on workshop: journalctl -u restic-backup.service -n 3',
          out: 'Oct 03 09:34:52 workshop restic-backup.sh[51877]: open repository\nOct 03 09:34:55 workshop restic-backup.sh[51877]: using parent snapshot 5e1c9a02\nOct 03 09:35:31 workshop restic-backup.sh[51877]: [0:36] 9.12%  1822 files 31.4 GiB, total 20114 files 344.2 GiB' }, ms: 2800 },
      { tool: { kind: 'file', doing: 'Reading its planning-automations skill', did: 'Read its planning-automations skill', out: '' }, ms: 2400 },
      { approve: { title: 'Create and change automations', detail: 'title: Check the photo backup\nschedule: 0 8 * * *  (every day at 8:00)\nprompt: ' + CHECK_PROMPT }, ms: 5200 },
      { tool: { kind: 'memory', doing: 'Scheduling: Check the photo backup', did: 'Scheduled: Check the photo backup', out: 'Created. Next run Sun, Oct 4, 8:00 AM.' }, ms: 2400, schedule: true },
      { tool: { kind: 'memory', doing: 'Updating its memory', did: 'Updated its memory', out: MEMORY_ADD.trim() }, ms: 2600, remember: true },
      { stream:
        '<p>The backup is running again. It is 9% through and should take about 35 minutes.</p>' +
        '<p>I also set up a check for every morning:</p>' +
        '<ul><li><strong>Every day at 8:00</strong> I will look at the last run on <code>workshop</code>.</li>' +
        '<li>If it finished cleanly, you will not hear from me.</li>' +
        '<li>If it failed or did not start, I will send you the error.</li></ul>' +
        '<p>It is on the Automations page if you want to change it.</p>' }
    ],
    entry: { title: 'Restarted the backup and set a daily check', outcome: 'The backup is running; a check runs every day at 8:00', at: '9:35 AM' }
  };
  var cannedReply = '<p>This prototype only knows the one conversation, so I cannot really answer that. In the app your message would go to me, and the reply would arrive here just like this, with the steps listed beside it.</p>';

  // ---- the other pages ----
  var schedules = [
    { id: 'cal', title: 'Morning calendar', cron: '0 9 * * 1-5', hm: [9, 0], next: 'Mon, Oct 5, 9:00 AM', enabled: true, runs: 29,
      prompt: 'Every weekday at 9, tell me what is on my calendar.', last: { when: 'Fri, Oct 2, 9:00 AM', outcome: 'reported back' } },
    { id: 'review', title: 'Weekly review', cron: '0 18 * * 0', hm: [18, 0], next: 'Sun, Oct 4, 6:00 PM', enabled: true, runs: 5,
      prompt: 'Write the weekly review from this week’s chats: what got done, what slipped, what is next. Save it to the library as a Markdown file and send it to me.', last: { when: 'Sun, Sep 27, 6:00 PM', outcome: 'reported back' } },
    { id: 'fan', title: 'Watch for new fan firmware', cron: '0 */6 * * *', hm: [12, 0], next: null, enabled: false, runs: 44,
      prompt: 'Check the vendor’s firmware page for the NAS fan controller. Only tell me if a version newer than 2.4.1 appears.', last: { when: 'Wed, Sep 30, 12:00 PM', outcome: 'had nothing to report' } },
    { id: 'passport', title: 'Remind me: passport photos', cron: 'once, Thu, Oct 1, 3:00 PM', hm: [15, 0], next: null, enabled: false, runs: 1, done: true,
      prompt: 'Remind me to get passport photos taken before the pharmacy closes at 6.', last: { when: 'Thu, Oct 1, 3:00 PM', outcome: 'reported back' } }
  ];
  var newSchedule = { id: 'backup', title: 'Check the photo backup', cron: '0 8 * * *', hm: [8, 0], next: 'Sun, Oct 4, 8:00 AM', enabled: true, runs: 0, fresh: true, prompt: CHECK_PROMPT, last: null };

  var files = [
    { name: 'backup-policy.md', ext: 'md', size: '1.2 KB', source: 'agent', when: 'Oct 3, 9:31 AM', chat: true },
    { name: 'weekly-review-2026-09-27.md', ext: 'md', size: '2.4 KB', source: 'agent', when: 'Sep 27, 6:01 PM', chat: true },
    { name: 'lisbon-itinerary.pdf', ext: 'pdf', size: '212 KB', source: 'agent', when: 'Sep 26, 4:18 PM', chat: true },
    { name: 'flight-confirmation.pdf', ext: 'pdf', size: '96 KB', source: 'you', when: 'Sep 26, 3:52 PM', chat: true },
    { name: 'fan-curve-before-after.png', ext: 'png', size: '84 KB', source: 'agent', when: 'Sep 21, 11:07 AM', chat: true },
    { name: 'registration-renewal-form.pdf', ext: 'pdf', size: '148 KB', source: 'you', when: 'Sep 18, 8:40 AM', chat: false },
    { name: 'ssh-workshop.sh', ext: 'sh', size: '0.6 KB', source: 'agent', when: 'Sep 14, 9:22 PM', chat: true },
    { name: 'subscriptions.csv', ext: 'csv', size: '3.8 KB', source: 'agent', when: 'Sep 9, 10:02 AM', chat: true },
    { name: 'gift-ideas.md', ext: 'md', size: '1.1 KB', source: 'agent', when: 'Sep 6, 7:45 PM', chat: true },
    { name: 'tax-checklist-2026.md', ext: 'md', size: '1.9 KB', source: 'agent', when: 'Sep 2, 1:30 PM', chat: true }
  ];

  var skills = [
    { name: 'writing-skills', source: 'Built in', on: true },
    { name: 'planning-automations', source: 'Built in', on: true },
    { name: 'browsing-the-web', source: 'Built in', note: '2 files', on: true },
    { name: 'checking-restic-backups', source: 'Written by the agent', on: true },
    { name: 'weekly-review', source: 'Written by the agent', on: true },
    { name: 'trip-planning', source: 'Written by the agent', on: false },
    { name: 'filling-pdf-forms', source: 'Installed', note: 'from GitHub · 3 files', on: true }
  ];
  var connectors = [
    { name: 'Calendar', url: 'https://mcp.calendar.example/mcp', state: 'Connected', note: '6 tools' },
    { name: 'Tasks', url: 'https://mcp.tasks.example/mcp', state: 'Needs sign-in', note: 'Sign in to the service to let your agent use it.' }
  ];
  var computers = [
    { name: 'workshop', meta: 'Linux · workshop.local', online: true, note: 'Your agent can work on this computer now.' },
    { name: 'fern', meta: 'macOS · fern.local · read-only', online: false, note: 'Last connected 14 h ago. Start the daemon there to bring it back.' }
  ];
  var permissions = [
    { title: 'What it can do', rows: [
      { label: 'Run commands', rule: 'allow' },
      { label: 'Create and change files', hint: 'Also applies to running commands and to copying a file from the library, since both can change files.', rule: 'allow' },
      { label: 'Send you files', rule: 'allow' },
      { label: 'Search the web', rule: 'allow' },
      { label: 'Create and change automations', rule: 'ask' },
      { label: 'Save and change skills', rule: 'allow' },
      { label: 'Change its memory and identity', hint: 'Also stops it changing them by editing the memory and identity files on its computer.', rule: 'allow' }
    ] },
    { title: 'Connectors', rows: [{ label: 'Use Calendar', rule: 'allow' }, { label: 'Use Tasks', rule: 'ask' }] },
    { title: 'Your computers', rows: [{ label: 'Work on workshop', rule: 'allow' }, { label: 'Work on fern', rule: 'ask' }] }
  ];
  var models = ['anthropic/claude-sonnet-5.5', 'anthropic/claude-opus-5.5', 'anthropic/claude-haiku-4.5', 'openai/gpt-5.1', 'google/gemini-3.8-flash'];
  var usage = { cost: '$18.42', read: '9.6M', written: '412K', rows: [
    ['anthropic/claude-sonnet-5.5', '9.1M', '$16.90'], ['anthropic/claude-haiku-4.5', '912K', '$1.52']
  ], scheduled: 'Scheduled runs account for $3.07 of the cost and 1.6M of the tokens.' };

  var pages = {
    library: { title: 'Library', icon: 'folder', desc: 'Files your agent has made for you, and files you have given it. They are kept here whatever happens to its computer.' },
    automations: { title: 'Automations', icon: 'clock', desc: 'Things your agent does on its own, once or on a schedule. To add one, ask in chat: “Every weekday at 9, tell me what is on my calendar.”' },
    skills: { title: 'Skills', icon: 'bolt', desc: 'Saved instructions your agent loads when a task calls for them. It writes new ones as it learns; you can also ask it to “save that as a skill”.' },
    connectors: { title: 'Connectors', icon: 'plug', desc: 'Services your agent can use, such as a calendar or a task tracker, connected through MCP. Your agent uses them without asking first, with whatever access you grant.' },
    computers: { title: 'Computers', icon: 'monitor', desc: 'Your own machines, connected so your agent can work on them: run commands, and read and write files. Everything it does there is logged on that machine.' },
    permissions: { title: 'Permissions', icon: 'shield', desc: 'Your agent acts without asking unless you say otherwise here. With “Ask first” it stops, tells you what it wants to do, and waits for your answer in the chat. Scheduled runs follow the same rules, and wait the same way.' },
    settings: { title: 'Settings', icon: 'sliders', desc: 'For your account. What one agent is like is set on that agent, under Identity and memory.' }
  };
  var nav = [
    ['chat', 'Chats', 'chat'], ['library', 'Library', 'folder'], ['automations', 'Automations', 'clock'], ['skills', 'Skills', 'bolt'],
    ['connectors', 'Connectors', 'plug'], ['computers', 'Computers', 'monitor'], ['permissions', 'Permissions', 'shield'], ['agent', 'Identity and memory', 'person']
  ];

  return { agent: agent, limits: limits, MEMORY_ADD: MEMORY_ADD, chats: chats, messages: messages, log: log, script: script, cannedReply: cannedReply,
    schedules: schedules, newSchedule: newSchedule, files: files, skills: skills, connectors: connectors, computers: computers,
    permissions: permissions, models: models, usage: usage, pages: pages, nav: nav };
})();
