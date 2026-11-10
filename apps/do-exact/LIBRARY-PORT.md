# Library port inventory

Reference read: library route, tree, viewer, document hook/panel/Markdown, file card, picture
viewer, pin shelf, sharing controls/sites, library/pin/site helpers, client and protocol types,
server shared-site route, and docs/reference/apps.md.

- Front page: workspace explanation, New document, empty/loading/error/missing file, Recent
  cards (image/Markdown previews, name, author/time/folder), all files, shared sites.
- Tree: expanded folders, collapse/choose upload destination, path filter and no matches,
  selection, kind/shared markers, new document, multi-upload, totals, deleted list and restore.
- Viewer: image, sandboxed HTML page (reload/new tab/theme/link messages), PDF, video/audio,
  CSV/TSV table, Markdown read/edit/split, editable text/code/source, oversized/unknown download.
- Document: formatting selection toolbar and word count, debounce save/status, conflict with
  Show theirs/Keep mine, keep draft on failed save, revisions and revert.
- File actions: rename/move by whole path (folders implicit), download, delete, pin/unpin,
  share. React has no standalone empty-folder creation or deletion confirmation.
- Chat integration: file card open by stable id, document beside chat, close/open in library;
  picture modal previous/next/download/keyboard. Export components for chat to use.
- Pins: first preview, title/change time, open/unpin, missing file persists.
- Sharing: file/folder, create restricted, copy/open link, private workspace/anyone, stop,
  errors/busy, list of existing shares incl. gone file. Shared URLs remain server-owned pages.

## Status and tests

- **Done:** front page, tree/filter/folders/destination, all file mutations, deleted files,
  revisions, Markdown/plain editing and autosave/conflicts, upload, viewers, pin/unpin and
  missing-pin data, restricted/public sharing and existing-sites list.
- **Partly:** Markdown is the single `LibraryMarkdown` swap point, not the separate rich
  renderer; the pins shelf has an update date instead of the transient changed flash.
- **Partly:** chat panel and pinned-file opener are mounted and tested. Reusable file cards
  and the picture gallery (buttons and arrow keys) are exported but not mounted in the
  basic transcript. Real chat tool attachments need the chat agent's integration.

Real-server Contract tests:

- `library.test.contract`: create, split editing/autosave, pin, restricted/public/stop
  sharing, filter, move into a folder, history/revert, delete/restore, reload and folder
  destination for a new document.
- `library-edit.test.contract`: browser formatting bridge, failed save/draft retention,
  retry, conflicting revision, Keep mine and Show theirs.
- `library-errors.test.contract`: initial load failure, retry, genuine empty state.
- `library-navigation.test.contract`: Back before the autosave debounce, reload/reopen,
  and New document while the current file has a dirty draft.
- `library-upload.test.contract`: seven picker uploads, Markdown, sandboxed page/source,
  bounded CSV with an unterminated last row and lossless source, plain code editing, image/enlarge, PDF and unknown/download surface.
- `pins.test.contract`: a real pin's preview opens its document over chat, close, unpin,
  and the underlying file remains.

`tools/library-shots.sh` and `tools/library-react-shots.mjs` run together: the Exact drive
keeps the same real server/account open while Playwright captures React at 1280×800 and
390×844, light and dark. Pictures are in `.exact/shots/library-{exact,react}`. The Playwright
script also checks restricted/public server URL access and a native browser download.

## Chat/Markdown integration

- Import `LibraryFileCard` from `views/library-card.contract`. It needs a stable `fileId`,
  `name`, optional preview URL and the `openLibraryPanel`/`libraryTogglePinFile` provisions.
  Give it a library **view URL**, not an authenticated API URL, for browser previews/downloads.
- `LibraryPictureViewer` takes `LibraryPicture[]`, owns its gallery index and exposes
  its `open` cell through `show=`. Its pictures need stable IDs, names and view URLs.
- `LibraryDocumentPanel` is already mounted by `app.contract` on dood/chat routes. Call
  `openLibraryPanel(fileId)`; the selection follows an ID through moves. No chat route
  replacement is needed. Close calls `closeLibraryPanel`.
- `PinsShelf()` is mounted in the real Dood panel's pinned slot. The temporary absolute
  `LibraryPinsDock()` and its root mount were removed when joining the creature panel.
- Replace only `LibraryMarkdown` when the rich renderer lands. `libraryContent.rendered`
  resolves relative library image/link URLs; `libraryText` is the raw editable source.
- Sharing overlays are root-mounted; `shareLibraryPath(path)` opens folder/file controls.
  Public/restricted URLs intentionally open the server website, not an Exact route.

Coverage limits: media controls are browser-native but no audio/video playback fixture is in
these tests. The PDF case asserts the browser frame, not PDF text extraction. Deleted/missing
pin shaping and existing-share missing-file labels are implemented but do not have a
separate end-to-end scenario. The unmounted chat card/gallery exports compile but are not
claimed as exercised real chat attachments.

Visual comparison: opened the matching home/document pictures at both sizes and schemes.
The front page has the same heading, recent-card row and file tray; the phone is the file
list or the document, not two squeezed columns. Remaining differences are visible and not
claimed as pixel parity: Exact's base Markdown shows an inline image's alt text instead of
its picture, uses looser paragraph spacing and a different heading scale; the toolbar is
below the pill, kind icons are monochrome, and the kept-safe row follows the list instead
of being pinned at the phone's bottom. The rich Markdown seam and shared shell account for
most of these. No controls or labels are clipped at the tested widths.

Autosaves use their own mutation (`librarySaved`), separate from creating/moving/reverting
files. The draft retains its file, agent and owner until it is saved; Back cannot make the
save target the next file, and a new-document mutation cannot replace the pending save.
A read is current only when its owner, file ID **and revision** match. Table source editing
reads the complete file up to the 1 MiB editor limit; larger tables use a bounded read-only
preview, not a partial string that could be written back over the complete file.

## Final verification

On branch `exact-library`, slot 4, 2026-11-10:

- `./x contract build app.contract`: passes; web build reports zero warnings.
- `./x test web`: passed the full suite; the final `./x verify` reran all 13 tests.
- `./x verify`: **clean in 168.6 s**, 13 passed / 0 failed. First screen, all 13 test
  ends and relaunch have no findings at 390×844 and 1280×900, light/dark. Reload checks
  have no findings. At the largest text size (root 53 px at 390×844), none of 17 screens
  spills. Model exploration reports no own refusals; Lean semantics did not run because
  `lake` is unavailable, as reported by Exact.
- Synchronized screenshot/browser run: Exact `check` has no findings; restricted shared
  URL is 401 to an anonymous browser, 200 to its owner, and public URL is 200 anonymously.
  A real native Download button produced `report.md` with the original Markdown bytes.
- No server changes and no changes to the Exact checkout. Nothing pushed.
