# Workflow safeguards for 0.11.0

Mok now gives each local project one editing tab. Other tabs can inspect it, play it, export it, download a portable copy, open another project, or choose **Edit a copy**. The ownership banner explains **Edit here** and **Release editing**. This is local protection against conflicting saves, not collaborative editing or a live mirror of another tab.

## Ownership and persistence

- A project lease lives in IndexedDB and expires after 30 seconds. The owner revalidates it every four seconds and on focus, visibility changes, or page restoration. An expired local lease blocks edits until it is verified again. BroadcastChannel and a localStorage notice make takeover visible promptly; the persistent write check is authoritative even if a sleeping tab misses those notices.
- Editor mutations, undo/redo, and direct project state replacement respect the editing boundary. Loading a different project is allowed and acquires its own lease. Gestures end when ownership is lost or a project is replaced, so their undo snapshots cannot attach to another document.
- Named saves and autosaves check their captured token in the same IndexedDB transaction that writes the project. A queued operation from the previous owner cannot overwrite the new owner. The project index is updated in that transaction too.
- Each project has a separate draft. Each tab remembers its open project in sessionStorage, while the legacy global autosave remains a fallback for a new tab and existing installations. The draft is authoritative by write order: undo can restore an older `updatedAt`, so timestamps do not select the winning revision. Explicit saves update the draft too.
- **Edit here** requests the current owner to flush and release, waits briefly for cooperation, then claims atomically. An unavailable or sleeping owner can be replaced. The previous tab keeps its local view and can download or fork it; **Edit here** deliberately opens the latest stored draft. Unsaved edits trapped in an unresponsive tab are not merged automatically.
- A true page reload may resume that tab's last token, rotating it before editing resumes. Opener-created or duplicated tabs cannot resume copied sessionStorage tokens because they are new navigations. A synchronous, tab-local snapshot on pagehide preserves an edit made inside the autosave debounce window. Recovery is accepted only on a real reload when the snapshot token still matches the authoritative lease. Released leases retain an expired token to reject stale recovery after a newer owner has edited and released the project.
- If ownership storage cannot be opened, **Session only** permits local editing but issues no persistent write ticket. The banner provides a portable download and explains that retrying opens the latest stored draft. Browser sessionStorage quota failures can prevent the final reload snapshot; the regularly saved draft remains the fallback.

Automatic global media pruning is paused while browser ownership is active. A different tab can hold an imported image or an undo reference absent from this tab's project and the saved project index. Retaining those blobs is the deliberate storage tradeoff until garbage collection can account for every tab's live references. This does not change the renderer's bounded in-memory resource caches.

For automation or browser QA, after `replaceProject`, `newProject`, or portable import opens another project ID, await `window.__mok.ownership.ready(id)` before editing. A false result means this tab could not acquire editing access. The debug handle also exposes ownership state, release, and takeover. Automation should keep using an isolated browser context.

## Logo insertion and keyframes

Both Timeline **Add → Logo** and shot-menu **Add logo shot** decode the selected file before creating a shot. Canceling creates nothing and leaves undo untouched. A successful import inserts one complete logo shot with one undo step. If the target project changes, its insertion target disappears, or ownership is lost while the picker/decoder is open, the operation is discarded and its unused import is cleaned up. Switching away and back still invalidates the pending insertion.

The keyframe context menu now offers **Delete all properties at this time**. It removes every keyed property at that timestamp in the selected shot, keeps neighboring times and other shots, removes empty property tracks, updates selection, and records one undo action.

## Verification

- `scripts/test-workflow.mjs`: seven focused Node regressions cover lease boundaries, read-only store/write-ticket behavior, session fallback, column deletion and undo, canceled and invalidated logo insertion, and project switches during gestures.
- `node --test scripts/test-workflow.mjs scripts/test-product.mjs scripts/test-io.mjs`: 19 checks passed, including the existing product and persistence suites.
- TypeScript and lint of changed application modules passed.
- `scripts/test-workflow-browser.mjs` uses an isolated Playwright Chromium context with multiple real tabs, shared IndexedDB and BroadcastChannel, real UI controls, and native file chooser events. All **14 checks passed on the final 0.11.0 production build**, with no page errors. This includes opener-created token-copy rejection, read-only UI and save blocking, cooperative takeover and stale-write rejection, stale-recovery rejection, release/reacquisition, wake revalidation, ordinary and immediate reload, independent per-tab drafts, both canceled logo paths, successful logo import with one undo, keyframe-column deletion with one undo, takeover after undo, and closing the owner. These are grouped into fourteen assertions in the script.

An earlier immediate-reload probe exposed debounce-window data loss. The final test specifically verifies its fix: a pending name change survives refresh before autosave runs. The final artifacts are in `work/workflow-qa-production-final/` in the surrounding task workspace.

Run the browser checks against a built or development server:

```sh
MOK_QA_URL=http://127.0.0.1:35362 MOK_QA_NODE_MODULES=/path/to/node_modules node scripts/test-workflow-browser.mjs ../workflow-qa-production
```

The script writes `report.json`, `readonly.png`, and `keyframe-column-undo.png` into its output directory, with diagnostic screenshots and tab states on failure. Its graphics flags use Chromium SwiftShader so these workflow checks do not require the host GPU.
