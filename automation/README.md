# mok local MCP automation

This standalone package lets an MCP client create portable mok projects, import local media, edit settings, and render images/videos with the same renderer as the editor. It runs over local **stdio**. It does not expose an HTTP MCP endpoint or attach to your existing browser tabs/profile.

## Setup

Requires Node 22+, npm, and the mok app running on a loopback address. The package has its own dependencies and lockfile; the editor does not depend on the MCP SDK or Playwright.

```sh
cd /absolute/path/to/mok/automation
npm ci
npm run browser:install
mkdir -p /absolute/path/to/mok-workspace
```

Start mok separately, with its normal dependencies already installed. A production build is preferable for repeatable exports because development HMR can interrupt a render:

```sh
cd /absolute/path/to/mok
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
```

Add this entry to the MCP client's server configuration using absolute paths. Different clients place this configuration in different files; this package does not modify client/account settings:

```json
{
  "mcpServers": {
    "mok-local": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/mok/automation/src/server.mjs"],
      "env": {
        "MOK_MCP_WORKSPACE": "/absolute/path/to/mok-workspace",
        "MOK_MCP_APP_URL": "http://127.0.0.1:3000"
      }
    }
  }
}
```

This follows the standard stdio command/arguments/environment pattern. Protocol messages exclusively use stdout; diagnostics use stderr. The official SDK handles negotiation, tool schemas, resource discovery, and cancellation notifications. [MCP server guide](https://modelcontextprotocol.io/docs/develop/build-server), [stdio transport specification](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports).

The app must be the trusted local mok instance. Only its configured origin can receive browser requests. `localhost`, `127.0.0.1`, and IPv6 `::1` are accepted; remote hosts, credentials in URLs, and URL queries/fragments are rejected.

## Tools

| Tool | Result |
| --- | --- |
| `mok_info` | Configuration, bounds, workflow; no browser launch |
| `mok_catalog` | Live selectable devices/finishes, built-in templates, scenes, effect definitions |
| `mok_create_project` | Portable `.mok` with optional name/template/device/aspect; project and shot ids |
| `mok_read_project` | Validated settings and SHA-256 revision, without embedded media bytes in the response |
| `mok_update_project` | JSON Pointer edits, editor validation, portable output |
| `mok_import_media` | Screen, logo, soundtrack, scene background, or screen background import |
| `mok_render_image` | Starts PNG/JPEG/WebP render job |
| `mok_render_video` | Starts MP4/WebM render job, including enabled audio |
| `mok_job_status` | Progress, state, error, or output path/bytes/hash |
| `mok_cancel_job` | Cancels queued/running work; completed outputs remain intact |

`mok://automation/config` is also available as a read-only MCP resource. Long exports return a job id immediately, so ordinary tool timeouts need not span the render. Poll status at about one-second intervals. These job tools use ordinary MCP requests; they do not require an experimental MCP task extension.

## Example workflow

Copy source media into the configured workspace. Tool arguments below are JSON, not shell commands.

1. Call `mok_catalog` with `{"kind":"devices"}` or `{"kind":"templates"}` to discover valid ids.
2. Create a project:

```json
{"path":"projects/launch.mok","name":"Launch","deviceId":"iphone-17-pro-glb","aspect":"16:9"}
```

3. Use a shot id from the returned project to call `mok_import_media`:

```json
{"path":"projects/launch.mok","outputPath":"projects/with-screen.mok","mediaPath":"assets/screen.png","target":"screen","shotId":"SHOT_ID_FROM_RESULT"}
```

4. Update the copied project with `mok_update_project`:

```json
{
  "path":"projects/with-screen.mok",
  "outputPath":"projects/finished.mok",
  "changes":[
    {"op":"set","path":"/camera/x","value":-18},
    {"op":"set","path":"/screen/brightness","value":1.1},
    {"op":"set","path":"/shots/0/duration","value":3},
    {"op":"set","path":"/duration","value":3}
  ]
}
```

Edits are data only. `set` replaces a value, `/shots/-` appends a shot, and `remove` deletes a field or array item. Parent objects must exist. Read the resulting project to see any normalization/clamping by the editor. IDs, version, and creation/update timestamps are managed by the app. JSON Pointer escaping is `~1` for `/` and `~0` for `~`; no code expressions are evaluated.

5. Call `mok_render_image`, then `mok_job_status` with its returned id:

```json
{"path":"projects/finished.mok","outputPath":"renders/launch.png","width":1920,"height":1080,"format":"png","time":1.5,"transparent":true,"transparentShadows":false}
```

For video, call `mok_render_video` with, for example:

```json
{"path":"projects/finished.mok","outputPath":"renders/launch.mp4","width":1920,"height":1080,"format":"mp4","fps":30,"quality":"high","samples":4}
```

Use `format:"webm"` and a `.webm` path for transparent video. `transparentShadows:true` retains the app's floor/contact shadow; `false` produces a cutout. JPEG does not support alpha. If this browser selects a different container as its encoder fallback, the job fails clearly; rerun with the reported format and matching extension instead of receiving a mislabeled file.

Video import follows the editor and may adjust clip duration. Set timing afterward. Source-video audio is disabled by default: opt in with a `set` on `/shots/0/audio` to `{"enabled":true,"volume":1,"fadeIn":0.1,"fadeOut":0.1}`. Trim, speed, looping, gaps, and source/soundtrack fades use the editor's audio/export code. Playback speed changes source-audio pitch. Video and still exports obey the project's current endpoint and scoped asset checks.

## Files, isolation, and cleanup

- Paths are relative to the dedicated workspace (recommended), or absolute paths within its canonical directory. Traversal and internal symlinks are rejected. The client cannot supply remote media URLs or arbitrary JavaScript.
- Existing output files require `overwrite:true`. Omitting `outputPath` on update/import selects the input path, so also requires that explicit overwrite flag. By default, save a new copy.
- `expectedRevision` can be the `revision` returned by read/create/update/import. An externally changed input is rejected before loading. This is a preflight check, not a filesystem transaction covering edits by unrelated programs.
- Portable files embed their media. Each operation restores its own copy in a new private browser context with separate IndexedDB, cookies, storage, and project ownership. The server does not open or dirty the user's active editor project. This also means unsaved user-tab edits and user-saved template libraries are unavailable; export a `.mok` file first.
- One browser operation runs at a time; at most eight wait in the queue. The newest 100 job records remain available until server exit. A job has a 30-minute limit.
- Results transfer in 256 KiB chunks to a workspace temporary file and appear at the final path only after successful completion. Failure/cancellation removes the temporary file. The app's OPFS output is released, then the private context is closed. In-flight cancellation gets up to five seconds for graceful cleanup before the context is forcibly closed.
- A cancelled or failed export does not delete an earlier successful file at the same path. A hard OS/process kill can leave an identifiable `.mok-part` file; delete that partial file after confirming the server is stopped. Finished output remains ordinary `.mok`, image, or video files.

## Configuration and practical limits

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `MOK_MCP_WORKSPACE` | Required | Dedicated absolute local workspace |
| `MOK_MCP_APP_URL` | `http://127.0.0.1:3000` | Running trusted local mok URL |
| `MOK_MCP_CHROMIUM_PATH` | Playwright-installed Chromium | Optional explicit compatible browser executable |
| `MOK_MCP_SOFTWARE_GL` | Off | Set `1` for SwiftShader in headless/CI environments |
| `MOK_MCP_MAX_PROJECT_BYTES` | 256 MiB | Portable input/output limit; configurable up to 512 MiB |
| `MOK_MCP_MAX_MEDIA_BYTES` | 128 MiB | Individual imported media limit; up to 256 MiB |
| `MOK_MCP_MAX_OUTPUT_BYTES` | 512 MiB | Published image/video limit; up to 4 GiB |

Byte settings use integer bytes. Render dimensions allow 16–8192 per side, subject to the renderer's hardware/memory planning; video is at most 180 seconds. A large render can still be rejected by available GPU memory or codec support. Software rendering is useful for tests but can be substantially slower than a desktop GPU. The portable format still uses JSON/base64 in the app, so its transient memory cost exceeds file size. Output limits are checked before workspace transfer; the app retains its own encoding/storage preflight limits while rendering.

This is a local automation interface, not cloud sync, Figma integration, or a remote multi-user render service. No secrets, account settings, or cloud credentials are needed. The adapter currently uses mok's existing `window.__mok` API; unsupported app builds fail readiness checks, and the renderer regression checks that contract.

## Tests

```sh
cd /absolute/path/to/mok/automation
npm test
MOK_MCP_APP_URL=http://127.0.0.1:3000 npm run test:render -- /absolute/path/to/test-output
```

The first command runs filesystem, mutation, queue/cancellation and genuine stdio protocol tests with the official SDK client; it needs no running app. The second runs the complete MCP-to-editor workflow, including GLB screenshot import/render, a transparent motion-blurred WebM, native frame/duration/alpha checks, queued/in-flight cancellation and recovery. It requires the running app, Chromium, and `ffmpeg`/`ffprobe` on PATH. It creates its own PNG fixture and saves a JSON report and output artifacts. Use a dedicated test directory because the regression deliberately overwrites its own known filenames.

Official implementation references: [MCP TypeScript SDK server documentation](https://ts.sdk.modelcontextprotocol.io/v2/), [official SDK repository](https://github.com/modelcontextprotocol/typescript-sdk).
