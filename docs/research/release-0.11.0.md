# mok 0.11.0 — selected UltraMock parity work

Implemented selected backlog items 2–7. This release does not add the seven deferred device models or claim complete UltraMock parity. It uses the existing credited models, original CC0 texture sources, and mok’s own renderer.

## What changed

| Item | Delivered |
| --- | --- |
| 2 — asset and surface quality | Original 2K concrete color/normal/packed surface maps, full GPU mipmaps, physical texture scale, complete 1K/JPEG fallbacks; restrained grain on the verified MacBook 14 enclosure materials. |
| 3 — transparent shadows | **Include ground shadow** in transparent image/video export. Black alpha coverage composites onto a later background; switching it off produces a cutout. Contact and cast shadows obey the choice; export state is restored on failure and completion. |
| 4 — workflow reliability | One editing tab per project, explicit takeover or editable copy, transaction-fenced saves, independent project drafts, pending-edit reload recovery. Both logo pickers are cancel-safe. **Delete all properties at this time** removes a keyframe column with one undo. |
| 5 — screen-light realism | Fixed deck/key/hinge geometry blocks screen spill and reflections. Area-light sampling preserves soft key-edge shadows; invisible helper planes are excluded. This extends the screen-to-keyboard lighting already present. |
| 6 — compatibility and loading | Native Mac GPU, Chrome/Firefox/WebKit exports, native Safari PNG export, mobile layout/panel checks and Chromium touch interactions. Unsupported WebP encoding is disabled. Lossless model transport reduces total model bytes by 10.6% with Brotli; MacBook 14 reduces by 36.8%. |
| 7 — local integration | A separate local stdio MCP package with ten tools for catalogs, portable projects, workspace media and cancellable render jobs. Private browser contexts protect active editor projects. |

The 2K concrete lifecycle check found and fixed a shader compilation issue when maps arrive after the first frame. The multi-tab checks found and fixed autosave-debounce data loss on immediate reload. MCP checks found and fixed shared-media references when multiple shots use the same image.

## Verification

- Application Node suite: **160/160 passed**. Full ESLint and production webpack build, including TypeScript validation, passed.
- Browser matrix: Chrome 152.0.7977.76, Firefox 153.0 and Playwright WebKit 26.5 on this Mac. PNG and JPEG passed all three; WebP passed Chrome/Firefox, and WebKit’s unsupported option was verified disabled. No page errors, failed requests or shader errors in the matrix.
- Chrome used **ANGLE Metal on Apple M4 Pro**, without software-renderer flags. The matrix also recorded the other engines’ reported GPU capabilities.
- Every engine exported MP4 and transparent WebM at 320×180, 12 fps, 0.5 seconds, four temporal samples. Native ffprobe/ffmpeg decoding confirmed six frames and 0.500-second duration. MP4 alpha was 255; WebM alpha ranged from 0 to 255.
- Transparent-shadow A/B on the actual MacBook 14 model verified thousands of added neutral shadow pixels, fully transparent corners and retained opaque device coverage.
- Native Safari 26.5.2 was operated through its actual UI: select MacBook 14, apply the Finance sample, enable transparency/ground shadow and export/download a valid 1920×416 PNG. Playwright WebKit is a separate engine build; the native Safari check is recorded separately.
- Mobile viewport 390×844 had no horizontal overflow in all three engines. Adjustment and timeline panels opened/closed successfully. Chromium additionally passed emulated touch taps and a touch orbit drag that changed the camera. Firefox/WebKit panel checks used the mouse because those sessions reported zero touch points.
- The standalone MCP package passed six core/protocol tests. Real MCP client → stdio server → private browser → GLB PNG and transparent VP9 video passed, as did queued/in-flight cancellation, post-cancel recovery, stale revision checks and shared-media preservation. Its WebM decoded to exactly four frames/0.400 seconds with alpha 0–255.
- Final production workflow suite: **14/14 passed**, including immediate reload during the autosave debounce, duplicated/opener tab token rejection, stale reload recovery rejection, takeover after undo, both logo-picker cancellations and keyframe-column undo. Final concrete checks verified automatic 2K shader activation, correct GL texture orientation and forced complete 1K fallback.

## Practical limits and tradeoffs

Physical iPhone/iPad touch hardware and additional GPU vendors were not available. Those device/browser combinations remain unverified; this is not an exhaustive hardware certification.

Screen-light blocking is a small height-field approximation, not ray tracing. It cannot represent every overhang or alpha-cutout hole. Geometry and the source models’ UVs are unchanged; higher source-model fidelity remains separate work.

The higher-detail 2K concrete set is about 12.4 MB to download and about 16 MiB in GPU memory. The complete 1K tier is about 3.1 MB/4 MiB. Model transport is byte-identical after decompression but adds about 107.4 MB of Brotli/gzip sidecars to repository/deployment storage. The already-compressed default iPhone 17 Pro improves by only 1.3%; the 36.8% figure applies to MacBook 14.

Persistent media garbage collection is paused while cross-tab ownership is active so one tab cannot remove another tab’s pending/undo media. Browser storage can therefore grow. Existing GPU/model caches remain bounded. Browser storage quota failures can still prevent the last synchronous reload snapshot; regular autosaves and portable downloads remain available.

MCP is local automation. It requires its separate dependencies, a running trusted local app and client configuration. It does not add cloud sync, accounts, Figma, remote rendering or access to unsaved editor-tab state.

## Details and reproduction

- [Visual assets, measurements and provenance](visual-0.11.0.md)
- [Ownership, logo insertion and keyframe checks](workflow-0.11.0.md)
- [MCP implementation and validation](mcp-0.11.0.md)
- [MCP setup and tools](../../automation/README.md)
- Browser checks: `MOK_QA_URL=http://127.0.0.1:3000 MOK_QA_NODE_MODULES=/path/to/node_modules node scripts/browser-matrix.mjs /path/to/artifacts`.
- Application checks: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.
- MCP checks: `cd automation && npm ci && npm test`; its README documents browser installation and full renderer checks.
