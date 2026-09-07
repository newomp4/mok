import { constants } from 'node:fs';
import { mkdir, realpath, lstat, open, link, rename, unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';

export function loopbackURL(value = 'http://127.0.0.1:3000') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('MOK_MCP_APP_URL must be an HTTP(S) loopback URL without credentials, query, or fragment.');
  }
  return url.href;
}

export class Workspace {
  static async create(directory) {
    if (!directory || !isAbsolute(directory) || resolve(directory) === sep) throw new Error('Set MOK_MCP_WORKSPACE to an absolute dedicated workspace directory.');
    await mkdir(directory, { recursive: true });
    return new Workspace(await realpath(directory));
  }
  constructor(root) { this.root = root; }
  async path(value, { createParents = false } = {}) {
    if (typeof value !== 'string' || !value.length || value.includes('\0') || value.split(/[\\/]/).includes('..')) throw new Error('Use a workspace path without traversal or null bytes.');
    const target = resolve(this.root, value), rel = relative(this.root, target);
    if (!rel || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path must be a file inside the configured workspace.');
    const parts = rel.split(sep); let current = this.root;
    for (let i = 0; i < parts.length; i++) {
      current = resolve(current, parts[i]);
      let entry;
      try { entry = await lstat(current); } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (i < parts.length - 1) {
          if (!createParents) throw new Error('Parent directory does not exist.');
          await mkdir(current); entry = await lstat(current);
        }
      }
      if (entry?.isSymbolicLink()) throw new Error('Symbolic links are not allowed inside the automation workspace.');
      if (i < parts.length - 1 && entry && !entry.isDirectory()) throw new Error('Parent path is not a directory.');
      if (i === parts.length - 1 && entry && !entry.isFile()) throw new Error('Path is not a regular file.');
    }
    return target;
  }
  async input(value, maxBytes, extensions) {
    const path = await this.path(value);
    if (extensions && !extensions.includes(extname(path).toLowerCase())) throw new Error(`Expected ${extensions.join(', ')} file.`);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes || stat.size === 0) throw new Error(`Input must be a nonempty regular file of at most ${maxBytes} bytes.`);
      return { path, bytes: stat.size };
    } finally { await handle.close(); }
  }
  async output(value, { overwrite = false, maxBytes, extensions } = {}) {
    const path = await this.path(value, { createParents: true });
    if (extensions && !extensions.includes(extname(path).toLowerCase())) throw new Error(`Output extension must be ${extensions.join(' or ')}.`);
    if (!overwrite) {
      try { await lstat(path); throw new Error('Output exists. Choose a new path or explicitly set overwrite=true.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const temporary = resolve(dirname(path), `.${basename(path)}.${randomUUID()}.mok-part`);
    const handle = await open(temporary, 'wx', 0o600); let bytes = 0, closed = false, committed = false;
    const close = async () => { if (!closed) { closed = true; await handle.close(); } };
    return {
      path,
      async write(chunk) {
        if (closed) throw new Error('Output is closed.');
        if (bytes + chunk.byteLength > maxBytes) throw new Error(`Output exceeds its ${maxBytes}-byte limit.`);
        let offset = 0;
        while (offset < chunk.byteLength) offset += (await handle.write(chunk, offset)).bytesWritten;
        bytes += chunk.byteLength;
      },
      commit: async () => {
        await handle.sync(); await close();
        await this.path(value); // Recheck parent paths and reject any newly introduced symlink.
        if (overwrite) await rename(temporary, path);
        else { await link(temporary, path); await unlink(temporary); } // Atomic no-clobber publication.
        committed = true;
        return { path: relative(this.root, path), bytes };
      },
      async cleanup() { await close(); if (!committed) await unlink(temporary).catch((e) => { if (e.code !== 'ENOENT') throw e; }); },
    };
  }
}
