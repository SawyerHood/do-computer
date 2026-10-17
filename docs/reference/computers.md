# Computers

A Dood has no computer of its own. A workspace, your own or a team's, has machines of the
kinds below, and its Doods work on them. A remote machine is created the first time something
runs on it, and stops by itself when nothing is using it.

- **Shared by default.** When you make a Dood in a workspace that has no machine it could
  use, the workspace is given one, of the kind under **Default computer** in Settings. It is
  open to every Dood of the workspace, so the Doods you make afterwards share it.
- **A folder each.** On a machine a Dood works in a folder of its own under the home
  directory, named after the Dood the first time it works there. Nothing stops it leaving that
  folder: Doods on one machine can read and change each other's files, which is how they hand
  work over, and it means a machine is not a wall between them.
- **More than one.** Under **Computers** in a workspace's settings you can add machines, and
  say for each whether every Dood of the workspace can use it or only the ones you choose. An
  Dood that can use one machine works there without being told to. One that can use several
  says which on each call, and one that can use none says so when a task needs one.
- **Asking.** A Dood can see the computers of its workspace and ask to use one it was not
  chosen for; whoever it belongs to answers.

The server's environment decides which kinds are on offer: the built-in shell and no computer
always, Daytona once `DAYTONA_API_KEY` is set, Modal once its two tokens are, and a Cloudflare
container when `DC_SANDBOX` is `cloudflare`. The keys stay in the environment and are never
shown or entered in the app. `DC_SANDBOX` is the kind a workspace gets when nobody has chosen,
and `DC_SANDBOX_KINDS` narrows what is offered, for example `just-bash,daytona`.

Deleting a machine deletes it at the provider, with everything on it. Deleting a Dood leaves
the machines it shared, and offers to delete one that only it could use. Moving a Dood to
another workspace takes along a machine only it could use; there it has that workspace's
machines, and that workspace's library.

| Kind         | The computer                                                                                  | Runs on          | What persists                                                                                       | Settings                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `just-bash`  | A shell interpreter with a virtual filesystem. No real programs; the internet through `curl`. | Node, Cloudflare | The workspace: on Node in one Dood's own database, on Cloudflare in a Durable Object of the shell's | on Cloudflare, the `worker_loaders` entry in `wrangler.jsonc`                                                |
| `daytona`    | A Linux machine on [Daytona](https://www.daytona.io)                                          | Node, Cloudflare | The whole disk                                                                                      | `DAYTONA_API_KEY`; optional `DAYTONA_API_URL`, `DAYTONA_TARGET`, `DC_DAYTONA_SNAPSHOT` or `DC_DAYTONA_IMAGE` |
| `modal`      | A Linux machine on [Modal](https://modal.com)                                                 | Node             | The workspace (`/workspace`, a Modal volume)                                                        | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`; optional `DC_MODAL_APP`, `DC_MODAL_IMAGE`, `MODAL_ENVIRONMENT`       |
| `cloudflare` | A Linux machine on [Cloudflare Containers](https://developers.cloudflare.com/containers/)     | Cloudflare       | The whole disk, as snapshots                                                                        | the `containers` entry in `wrangler.jsonc`; optional `DC_CLOUDFLARE_IMAGE`, `DC_CLOUDFLARE_INSTANCE`         |
| `none`       | No machine is added. Doods can still work on computers of yours that are paired with them.    | Node, Cloudflare |                                                                                                     | none                                                                                                         |

Things to know before choosing one:

- **On Node the built-in shell is not shared.** Its files are in one Dood's database, so where
  it is the default every Dood gets its own, which goes when the Dood is deleted. On
  Cloudflare it is a machine like the others: a workspace is given one for its Doods to share,
  each in a folder of its own, and more can be added under Computers.
- **On Cloudflare the built-in shell is [Cloudflare Computer](https://github.com/cloudflare/computer)'s.**
  Its files are in a Durable Object of its own (about 10 GB, read as they are needed), and each
  command runs in a Dynamic Worker started for it, which can reach those files and, through the
  server, the public internet, and nothing else. That needs the Workers Paid plan: Dynamic
  Workers are billed per shell per day it is used, after the first thousand a month. The
  package is a preview and says of itself that it is not for production. On Node the shell runs
  inside the server, with every file held in memory (64 MB at most). A shell that ran inside a
  Cloudflare deployment before this has its files moved over the first time it is used; the
  old tables stay in the Dood's database as `dc_fs_moved` and `dc_fs_chunks_moved`.
- **What the Cloudflare shell does not do:** a command that its caller stops, or that runs past
  its time, is no longer waited for but runs on until ten minutes are up, since the shell's
  Worker cannot be told to stop; and what it prints arrives when it is over, not as it goes.
- **Daytona** stops a machine after 15 minutes without use and starts the same machine again on
  the next command. A machine is only ever created when Daytona says there is none; if Daytona
  cannot be reached the Dood is told so, and no empty replacement is made.
- **Modal** stops a machine after 15 minutes without use, and after a day at most. A stopped
  machine is gone, so the next command gets a new one with the same workspace. Packages installed
  outside `/workspace` last until then.
- **Cloudflare** needs the Workers Paid plan. Uncomment the `containers` line in
  `apps/web/wrangler.jsonc` and set `DC_SANDBOX` to `cloudflare`, or add `cloudflare` to
  `DC_SANDBOX_KINDS` to offer it without making it the default. Machines start from Cloudflare's
  managed Debian image, so there is nothing to build. A machine is saved as a snapshot after ten
  minutes without use, and every fifteen while in use, then started from that snapshot.
  Snapshots are in public beta and expire after 30 days, so a stopped machine is restored and
  saved again every 20 days; a Dood can be left alone for months and keep its disk.
- On every remote machine, running processes do not survive a stop. Files do, as described above.
- Changing `DC_SANDBOX` changes what a workspace is given from then on. Machines that exist
  stay as they are.
- If a kind stops being offered, because its key was removed or `DC_SANDBOX_KINDS` changed, its
  machines cannot be reached until it is offered again, and cannot be deleted either: delete
  them while the kind is offered, or remove them at the provider.
- **Doods from before machines were shared** keep the machine each had, as a computer of its
  workspace that only that Dood can use. Open it to the workspace, or connect other Doods to
  it, under Computers.

Daytona has been run for real, on Node and in the Workers runtime: creating the machine, the
shell, file tools, stopping and coming back with its files, moving a Dood to it from the
built-in shell and back, and deletion. To repeat that against
your own account: `DAYTONA_API_KEY=... pnpm --filter @do-computer/sandbox exec vitest run
test/daytona.live.test.ts` (it creates one machine and deletes it). Modal and Cloudflare
Containers are tested against stand-ins that run real commands, and have not yet been run with a
real account: treat the first deployment on either as a trial.

## Pictures a Dood is shown

A conversation keeps every picture its model was shown for as long as it lasts, and sends them
all again with every request, in the memory of the Dood's own Durable Object. So a picture is
made small before it reaches the Dood, wherever that is cheap, and the Dood never decodes one:

- **Read from a computer of yours.** When a Dood `read`s a `.png`, `.jpg` or `.jpeg` file on a
  paired computer whose daemon says `images` in its hello, the server asks the daemon for it
  with an `image` frame rather than for the file (`packages/agent/src/read-images.ts`). The
  daemon (`packages/computers/src/node-image.ts`, pure JavaScript: jpeg-js and pngjs, bundled
  into its one file) scales it to a long edge of 1568 pixels and 1.15 megapixels, or the
  model's own smaller limits, which is what Anthropic scales a larger picture to before the
  model sees it; turns a photo upright as its EXIF orientation says; and makes it a JPEG at
  quality 80 (a PNG where it has transparency), stepping down to 50 only where it is still over
  640 KB. A JPEG that needs no change, and a flat drawing that is smaller as the PNG it is, are
  sent as they are. `read` says what was done ("Converted from image/png to image/jpeg. Resized
  from …"), as it would have. Anything else is read as it always was: WebP and GIF, a model
  that does not take pictures, a picture of more than 25 megapixels or still too large, and a
  daemon from before this.
- **A browser on a computer of yours.** The pictures a script takes are made no larger the same
  way, on the computer, before they are sent.
- **The screen of a computer of yours** is already sent as a JPEG of at most 1280 pixels.
- **A page a Dood looks at** (`look`, and drawing a page) is pictured as a JPEG at quality 80
  in place of a PNG.
- **A picture attached or pasted in the app** is scaled in the browser, or on the phone, to
  1568 pixels and 1.15 megapixels at most, and goes as a JPEG.
- **A connector's answer** may carry four pictures, and about a megabyte of them together. One
  that does not fit is left out, and the Dood is told so in its place: nothing on the server
  scales a picture.
- **Slack** sends the smaller copy it makes of a picture, four at most to a message.
- **The machines of a workspace** (`just-bash`, Daytona, Modal, Cloudflare containers) have no
  daemon, so a picture read on one is read as it is, as pi-durable's `read` takes it: up to
  2000 pixels and 4.5 MB of base64.
