# Local MCP interface — 0.11.0

Implementation scope: a local stdio automation server using the actual mok editor/renderer in private browser contexts. This document describes implemented behavior, not UltraMock internals or a cloud integration roadmap.

## Primary-source decisions

The official MCP documentation specifies stdio for locally launched servers and reserves stdout for protocol messages. The server uses the official SDK transport and stderr for diagnostics. Tools use declared schemas, structured results, and tool error results; a read-only configuration resource complements the tools. [MCP transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [official server guide](https://modelcontextprotocol.io/docs/develop/build-server).

The separately installed packages are pinned in `automation/package-lock.json`: `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/client` 2.0.0 for tests, Playwright 1.63.0, and Zod 4.5.4. The official SDK's `serveStdio` supports current and established initialize-based protocol clients; both paths are covered by the protocol regression. [SDK repository](https://github.com/modelcontextprotocol/typescript-sdk), [SDK stdio API](https://ts.sdk.modelcontextprotocol.io/v2/api/%40modelcontextprotocol/server/server/serveStdio.html).

## Implementation map

| File | Responsibility |
| --- | --- |
| `automation/src/server.mjs` | Ten MCP tools, schemas, annotations, resource, stdio startup/shutdown |
| `automation/src/service.mjs` | Portable project workflows, revision checking, chunked result transfer, render orchestration |
| `automation/src/browser.mjs` | Nonpersistent Playwright context, local-origin request policy, app API adapter, capture cancellation/release |
| `automation/src/workspace.mjs` | Canonical workspace, traversal/symlink rejection, size/extension checks, atomic no-clobber output |
| `automation/src/jobs.mjs` | Single-operation queue, progress/status, cancellation, timeout, bounded history |
| `automation/src/changes.mjs` | Data-only JSON Pointer editing and prototype-key rejection |
| `automation/README.md` | Reproducible setup, generic MCP client configuration, workflow and limitations |

The adapter reuses the existing app API in `src/components/editor/hooks.ts`: `useEditor`, `actions`, `persistence`, `capture`, device/template catalogs, and the renderer registry. No new HTTP route or public automation endpoint was added. `src/lib/persistence.ts` remains responsible for portable import/export; `replaceProject` uses the app validator. `src/export/capture.ts` remains responsible for media readiness, scoped assets, quality planning, WebGL output, motion samples, codec selection, audio, and cleanup.

Every queued operation gets a fresh private context with its own cookies, local/session storage, IndexedDB and project ownership state. It does not connect to an existing browser profile or tab. The adapter awaits the ownership API when present before changing a newly opened project. Closing a context discards its editor state. Existing user projects and tabs are not opened or modified.

Portable imports deliberately regenerate media IDs. The adapter keeps source-file IDs stable in read responses and translates submitted references into the private context's loaded IDs before applying edits. The end-to-end test specifically checks that replacing a complete shot array preserves the embedded image payload. Arbitrary new media references are rejected; clients attach sources through the import tool.

## Supported actions

Discover the app's selectable devices/finishes, built-in templates, scenes and effect definitions; create, read and update portable `.mok` files; import screen/logo/background/screen-background/soundtrack media; render PNG/JPEG/WebP and MP4/WebM; inspect and cancel render jobs. Source-video audio, motion blur, transparency and transparent-shadow behavior are passed through to existing capture options. Long exports return a job id immediately and need no experimental MCP task extension.

All paths stay inside a configured workspace. Existing outputs require explicit overwrite. Input revisions are SHA-256 preflight guards against stale edits, not a transaction with unrelated filesystem writers. Output transfers use 256 KiB chunks; a final name is published atomically only after completion. The app's disk-backed export is released before context disposal. Queued and active cancellation clean temporary output and permit another job.

Defaults: 256 MiB portable files, 128 MiB individual media imports, 512 MiB published output, eight queued jobs, 100 retained job records, 30-minute job deadline. Video is at most 180 seconds and dimensions are additionally constrained by renderer/GPU planning. See the README for configurable bounds.

## Validation

`cd automation && npm test` passes six regressions: workspace boundary/no-clobber/partial cleanup, JSON Pointer editing protections, queue/cancellation/recovery/history, an official SDK client interacting with the real stdio server, and a separate 2025-11-25 legacy initialization/tools exchange. Tests cover tool/resource discovery, structured results/errors, rejected output traversal, and failed-job polling.

`npm run test:render -- /absolute/test-output` is a genuine MCP client-to-server-to-editor test. It generates a PNG fixture, creates a template project, imports and persists the screenshot, updates and rereads portable settings, checks repeated/shared media and stale revisions, renders a GLB still and an alpha motion-blurred WebM, checks native frame count/duration/alpha, cancels queued/in-flight work, and renders again after cancellation. Its artifacts/report live in the supplied test directory.

The stable local production run passed the complete workflow: 320×180 GLB PNG; transparent VP9 WebM with two motion samples, exactly four decoded frames and a 0.400-second endpoint; native decoded alpha spanning 0–255; queued and in-flight cancellation; successful capture afterward; no partial/cancelled output files or server diagnostics. `mcp-render-report.json` records the output hashes, native probe and checks. The test used Chromium with SwiftShader through the explicit executable-path setting. This exercises the new code in the pre-release production build; its app version label still read 0.10.0 before the 0.11.0 release bump.

A follow-up real-client portable regression also passed after the shared-reference fix: two shots retained their one embedded source after an unrelated camera edit, read responses retained stable file media IDs, and setting an invalid scene value used the editor's normal defaulting behavior. `mcp-shared-media-report.json` records those checks.

The package's files pass repository ESLint. No root runtime dependency or account/client configuration was modified.

## Limits and exclusions

The local app must already be running. Production mode is preferable because HMR can invalidate an in-flight browser evaluation. Browser/GPU/encoder support and memory affect practical export size and performance. Chromium is the automation browser; this is not a claim of complete multi-engine automation coverage.

Portable JSON/base64 serialization still occurs in the app and can temporarily use more memory than the file size. The publication limit is checked before workspace transfer; the capture layer applies its own preflight/storage bounds during encoding. Hard process/OS termination can leave an identifiable `.mok-part` file for manual removal after the server stops.

Unsaved edits in a user's active tab, user-specific browser storage, saved template libraries in that other profile, cloud sync and Figma integration are outside this interface. Transfer an explicit `.mok` file into the automation workspace when using an existing project. No plugin or MCP entry is installed into a user's account by this implementation.
