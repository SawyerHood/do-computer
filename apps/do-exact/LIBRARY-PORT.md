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
