import {spawnSync} from 'node:child_process';

/** FFmpeg8's complete-frame Opus parser tries to parse its zero-byte EOF flush. Recheck with
 * the redundant parser disabled, but still require identical output and a clean real decoder. */
export function nativeDecode(args, {maxBuffer, label, opus = false}) {
  const run = (flags = []) => spawnSync('ffmpeg', [...flags, ...args], {maxBuffer});
  const first = run();
  if (first.error || first.status !== 0) throw new Error(`${label}: ${first.error ?? first.stderr}`);
  const warning = first.stderr.toString();
  if (!warning) return {...first, probeWarning: ''};
  if (!opus || !/^\[opus @ [^\]\n]+\] Error parsing Opus packet header\.\s*$/.test(warning)) throw new Error(`${label}: ${warning}`);
  const decoded = run(['-fflags', '+noparse+nofillin']);
  if (decoded.error || decoded.status !== 0 || decoded.stderr.length) throw new Error(`${label}: ${decoded.error ?? decoded.stderr}`);
  if (!decoded.stdout.equals(first.stdout)) throw new Error(`${label}: parser-disabled output differs; warning is not safely attributable to EOF`);
  return {...decoded, probeWarning: warning};
}
