# Exact port gaps

## Web native views

The creature, wardrobe gift/tiles, island portrait and first-run sky now use the existing
three.js mascot through web native views, not a rewritten model. There is no Apple/Linux
implementation. The agent sees each labelled native tag and its props/events, but not its
shadow DOM or meshes, so canvas correctness needs screenshots. Page modules are served
unchanged: `modules/web/build.mjs` generates the committed local dependency bundle rather
than relying on npm or outside-folder imports in the browser. Exact's hatch clock drives
animation; the mascot package's deferred GPU-resource disposal still uses its own wall-clock
timer (no visible animation depends on it). The native view's box contains the whole picture;
React's `AgentAvatar` overscans its span by 12%. The first-run view includes the sky, fall and
hatch from `components/welcome/stage.ts`, but not the UI's flight from island to chat: the
screen that owns both boxes must implement that transition. Petting emits `message="pet"`;
the Contract caller must apply server care limits and mutations, as React's creature care
does. If WebGL is unavailable, `do-creature` uses the protocol's plain SVG; it has no clothes,
seed-specific silhouette or egg, like React's stand-in. Syntax highlighting, Mermaid and other
foreign views are not implemented by this piece; PORTING.md's Native views section gives the
worked integration recipe.
