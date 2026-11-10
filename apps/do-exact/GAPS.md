# Exact port gaps

## Web native views

The creature, wardrobe gift/tiles, island portrait and first-run sky now use the existing
three.js mascot through web native views, not a rewritten model. There is no Apple/Linux
implementation. The agent sees each labelled native tag and its props/events, but not its
shadow DOM or meshes, so canvas correctness needs screenshots. Page modules are served
unchanged: `modules/web/build.mjs` generates the committed local dependency bundle rather
than relying on npm or outside-folder imports in the browser. Exact's hatch clock drives
animation; the mascot package's deferred GPU-resource disposal and WebGL retry bookkeeping
still use its wall clock (no visible animation depends on it). Sky particles use its unseeded
randomness, so clock stepping controls their timing but does not promise pixel-identical
confetti on every launch. The native view's box contains the whole picture;
React's `AgentAvatar` overscans its span by 12%. The first-run view includes the sky, fall and
hatch from `components/welcome/stage.ts`, but not the UI's flight from island to chat: the
screen that owns both boxes must implement that transition. Petting emits `message="pet"`;
the Contract caller must apply server care limits and mutations, as React's creature care
does. If WebGL is unavailable, `do-creature` uses the protocol's plain SVG; it has no clothes,
seed-specific silhouette or egg, like React's stand-in. Rich message content is now implemented
separately below; PORTING.md's Native views section gives the integration recipe.

## Data-free gallery verification

Exact's `scripts/verify.mjs:1371` launches several web drives together for an app without a
server. With the required port 8766 pin they collide (`port 8766 (--port or EXACT_PORT) is in
use: another drive or program holds it`), even though no other process holds the port before
or after the command. The gallery is checked sequentially with `./x test web --size …` and
`./x agent web … "check both"` instead; the machine-wide lock and port policy are unchanged.
The root app's verify still passes its account/chat test and normal light/dark checks, but
reports its existing persisted `performanceNow()` warning and two largest-text layout findings;
its screens were not changed by the native-view work. No Exact patch was made.


## Rich message content

`views/markdown.contract` and the web-only `do-markdown`, `do-code` and `do-mermaid` tags
render the React app's sanitized GFM, highlighted code, scrolling/copyable tables, GitHub
alerts, folding HTML and diagrams. Exact's `text markup="markdown"` reader leaves tables as
text and does not supply these controls; it is retained for simple prose. Rich messages stay
in one shadow DOM tree so selection crosses prose and code. The native content has natural
web layout height; no Apple/Linux implementation or native intrinsic sizing was added. The
Exact agent sees tags/props, not their text or buttons; the separate gallery's Playwright
probe tests those. A simple reply can change renderer once richer syntax arrives, which may
lose a selection over that change. The real chat has not been wired while another branch
rewrites it; the exact `MessageText` call is in `modules/web/README.md`.

React's `components/chat/markdown.tsx` resolves library links and images using the chat's
library query, previews local CSV/TSV, opens files beside the chat, refreshes expired view
URLs, and uses the full multi-picture viewer with download. This presentation-only piece
accepts a caller-resolved `files` prop and emits `file:<id-or-path>`, renders known image
URLs and browser video/audio controls, and otherwise shows alt text. It does not fetch the
library, preview CSV/TSV, refresh authorization, open a side panel, or provide the picture
viewer. A figure opens in a new tab and emits `image:<url>`. The chat/library owner must
supply browser-loadable URLs and consume file events; no bearer secret belongs in props.
Attachments that are separate message blocks remain that screen's responsibility.

Remote pictures/media wait for Show, as in React, but there is no persistent Always from
this host permission yet. Responsive raw-HTML `<source srcset>` is skipped because it could
make a request around that gate. Failed pictures show their words. Raw HTML uses the exact
React sanitizer, not unrestricted innerHTML; only strict Mermaid's own sanitized SVG is
inserted as markup. Alerts have their kind/title/color but not the React icon set, and fonts
inherit the host rather than shipping React's Geist fonts. Code over 80,000 characters and
unknown languages remain plain, as in React. There is no math renderer or custom mention
widget in the React reference either: math delimiters and @names remain text.
