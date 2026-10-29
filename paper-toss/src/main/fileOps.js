'use strict';

/**
 * Filesystem operations for Paper Toss.
 *
 * Safety model
 * ------------
 * 1. The renderer never sends a path to delete. When the user picks an item,
 *    the main process inspects it and hands back an opaque, single-use token.
 * 2. At deletion time the token is resolved back to the exact path and the
 *    item's identity (device + inode / file id, kind) is re-checked. If the
 *    item is gone, was replaced, or changed type, nothing happens.
 * 3. Items are only ever moved to the OS Recycle Bin / Trash. There is no
 *    permanent-delete code path in this module at all.
 * 4. Drive roots, the home folder (and its ancestors), system folders and the
 *    app's own folder are refused up front.
 *
 * All exported operations resolve to plain objects (never throw across IPC):
 *   { ok: true, ... }  or  { ok: false, code, message }
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const fsp = fs.promises;

const MAX_PATH_LENGTH = 32767;
const LARGE_ITEM_BYTES = 4 * 1024 ** 3; // 4 GiB: may exceed the Recycle Bin quota
const WALK_MAX_ENTRIES = 50000;
const WALK_TIME_BUDGET_MS = 1500;
const MAX_BATCH = 25;

const MESSAGES = {
  'invalid-path': 'That path is not valid.',
  'protected': 'That location is protected and cannot be thrown away.',
  'missing': 'The item no longer exists. Nothing was deleted.',
  'permission': 'You do not have permission to move this item. Nothing was deleted.',
  'locked': 'The item is open or in use by another program. Close it and try again. Nothing was deleted.',
  'changed': 'The item changed since you picked it, so it was left alone for safety.',
  'stale-selection': 'This selection has expired. Please pick the item again.',
  'unsupported': 'This kind of item cannot be thrown away.',
  'too-large': 'The item is too large for the Recycle Bin, so it was left alone. Nothing was permanently deleted.',
  'trash-failed': 'The operating system could not move the item to the trash. Nothing was deleted.',
  'too-many': 'Pick up to 25 items at a time.',
  'nested': 'This is already inside a folder you picked, so it goes with that folder.',
  'unknown': 'Something unexpected went wrong. Nothing was deleted.',
};

class FileOpError extends Error {
  constructor(code, detail) {
    super(MESSAGES[code] || MESSAGES.unknown);
    this.code = code;
    this.detail = detail;
  }
}

function failure(err) {
  if (err instanceof FileOpError) {
    return { ok: false, code: err.code, message: err.message, detail: err.detail || null };
  }
  const code = classifySystemError(err);
  return { ok: false, code, message: MESSAGES[code], detail: err && err.message ? String(err.message) : null };
}

/** Map Node errno codes and OS trash error text to our error codes. */
function classifySystemError(err) {
  if (!err) return 'unknown';
  switch (err.code) {
    case 'ENOENT':
    case 'ENOTDIR':
      return 'missing';
    case 'EACCES':
    case 'EPERM':
      return 'permission';
    case 'EBUSY':
    case 'ETXTBSY':
      return 'locked';
    case 'ENAMETOOLONG':
    case 'EINVAL':
      return 'invalid-path';
    default:
      break;
  }
  const text = String(err.message || err);
  if (/being used|in use|sharing violation|locked|EBUSY/i.test(text)) return 'locked';
  if (/access is denied|permission|not permitted|EACCES|EPERM/i.test(text)) return 'permission';
  if (/permanently deleted|too (big|large)|exceeds/i.test(text)) return 'too-large';
  if (/cannot find|no such file|not found|ENOENT/i.test(text)) return 'missing';
  return 'trash-failed';
}

function kindOf(stat) {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isDirectory()) return 'directory';
  if (stat.isFile()) return 'file';
  return 'other';
}

/** Identity fingerprint used to make sure we trash exactly what was picked. */
function identityOf(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    kind: kindOf(stat),
    birthtimeNs: stat.birthtimeNs ? stat.birthtimeNs.toString() : null,
  };
}

function sameIdentity(a, b) {
  if (a.kind !== b.kind || a.dev !== b.dev) return false;
  // Some filesystems (FAT, certain network shares) report inode 0.
  // Fall back to creation time in that case.
  if (a.ino === '0' || b.ino === '0') return a.birthtimeNs !== null && a.birthtimeNs === b.birthtimeNs;
  return a.ino === b.ino;
}

function createFileOps(options = {}) {
  const {
    trashItem,
    platform = process.platform,
    homedir = os.homedir(),
    env = process.env,
    appPaths = [],
  } = options;

  if (typeof trashItem !== 'function') throw new TypeError('createFileOps requires a trashItem function');

  const isWin = platform === 'win32';
  const p = isWin ? path.win32 : path.posix;
  const selections = new Map();

  const norm = (value) => {
    let out = p.resolve(value);
    // Strip trailing separators, but keep roots like "C:\" and "/" intact.
    while (out.length > p.parse(out).root.length && /[\\/]$/.test(out)) out = out.slice(0, -1);
    return isWin ? out.toLowerCase() : out;
  };
  const isInside = (child, parent) => child !== parent && child.startsWith(parent.endsWith(p.sep) ? parent : parent + p.sep);

  // Locations that must never be trashed, nor anything containing them.
  const homeGuard = [homedir].filter(Boolean).map(norm);
  // Locations where neither the folder, its ancestors nor its descendants may be trashed.
  const systemGuard = (isWin
    ? [env.SystemRoot || env.windir || 'C:\\Windows', env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramData]
    : ['/System', '/Library', '/Applications', '/usr', '/bin', '/sbin', '/etc', '/var', '/boot', '/dev', '/proc', '/sys', '/opt', '/lib', '/lib64'])
    .concat(appPaths)
    .filter(Boolean)
    .map(norm);

  function validatePath(input) {
    if (typeof input !== 'string' || input.length === 0) throw new FileOpError('invalid-path', 'Path is empty.');
    if (input.length > MAX_PATH_LENGTH) throw new FileOpError('invalid-path', 'Path is too long.');
    if (input.includes('\0')) throw new FileOpError('invalid-path', 'Path contains a null byte.');
    if (!p.isAbsolute(input)) throw new FileOpError('invalid-path', 'Path must be absolute.');
    if (isWin && /^\\\\[?.]\\/.test(input)) throw new FileOpError('invalid-path', 'Device paths are not supported.');
    return p.resolve(input);
  }

  function assertNotProtected(resolved) {
    const n = norm(resolved);
    if (n === norm(p.parse(resolved).root)) throw new FileOpError('protected', 'Drive and filesystem roots are protected.');
    for (const guard of homeGuard) {
      if (n === guard || isInside(guard, n)) throw new FileOpError('protected', 'Your home folder is protected.');
    }
    for (const guard of systemGuard) {
      if (n === guard || isInside(guard, n) || isInside(n, guard)) {
        throw new FileOpError('protected', 'System and application folders are protected.');
      }
    }
  }

  /** Count a folder's contents without following links, within a time/entry budget. */
  async function summarizeFolder(dir) {
    const started = Date.now();
    const summary = { files: 0, folders: 0, bytes: 0, truncated: false, unreadable: 0 };
    const stack = [dir];
    let seen = 0;
    while (stack.length) {
      if (seen >= WALK_MAX_ENTRIES || Date.now() - started > WALK_TIME_BUDGET_MS) {
        summary.truncated = true;
        break;
      }
      const current = stack.pop();
      let handle;
      try {
        handle = await fsp.opendir(current);
      } catch {
        summary.unreadable += 1;
        continue;
      }
      try {
        for await (const entry of handle) {
          seen += 1;
          const full = p.join(current, entry.name);
          if (entry.isDirectory()) {
            summary.folders += 1;
            stack.push(full);
          } else {
            summary.files += 1;
            if (entry.isFile()) {
              try {
                summary.bytes += (await fsp.lstat(full)).size;
              } catch {
                summary.unreadable += 1;
              }
            }
          }
          if (seen >= WALK_MAX_ENTRIES) break;
        }
      } catch {
        summary.unreadable += 1;
      }
    }
    return summary;
  }

  /** Validate and inspect one path. Does not register anything. */
  async function inspect(input) {
    try {
      const resolved = validatePath(input);
      assertNotProtected(resolved);

      let stat;
      try {
        stat = await fsp.lstat(resolved, { bigint: true });
      } catch (err) {
        throw new FileOpError(classifySystemError(err), err.message);
      }
      const identity = identityOf(stat);
      if (identity.kind === 'other') throw new FileOpError('unsupported', 'Devices, pipes and sockets are not supported.');

      const info = {
        name: p.basename(resolved),
        path: resolved,
        parent: p.dirname(resolved),
        kind: identity.kind,
        size: Number(stat.size),
        modified: Number(stat.mtimeMs),
        created: Number(stat.birthtimeMs),
        extension: identity.kind === 'file' ? p.extname(resolved).slice(1).toLowerCase() : '',
        contents: null,
        warnings: [],
      };

      if (identity.kind === 'directory') {
        info.contents = await summarizeFolder(resolved);
        info.size = info.contents.bytes;
        if (info.contents.unreadable) info.warnings.push('Some items inside could not be read. They may block the move.');
      }
      if (identity.kind === 'symlink') {
        info.warnings.push('This is a link. Only the link will be moved, not what it points to.');
      }
      if (info.size >= LARGE_ITEM_BYTES) {
        info.warnings.push('This is very large. If it does not fit in the Recycle Bin, it will be left alone rather than permanently deleted.');
      }

      return { ok: true, info, record: { path: resolved, identity } };
    } catch (err) {
      return failure(err);
    }
  }

  /**
   * Inspect a batch of picked paths and issue one single-use token per valid
   * item. A new batch replaces (invalidates) every token from earlier batches.
   * Invalid items come back as { ok: false, code, message, name, path }.
   */
  async function selectMany(inputs) {
    selections.clear();
    if (!Array.isArray(inputs) || inputs.length === 0) return failure(new FileOpError('invalid-path', 'Nothing was picked.'));
    if (inputs.length > MAX_BATCH) return failure(new FileOpError('too-many'));

    const seen = new Set();
    const inspected = [];
    for (const input of inputs) {
      const result = await inspect(input);
      const shown = typeof input === 'string' ? input : '';
      if (!result.ok) {
        inspected.push({ ...result, path: shown, name: shown ? p.basename(shown) : '(invalid)' });
        continue;
      }
      const key = norm(result.record.path);
      if (seen.has(key)) continue; // the same item picked twice
      seen.add(key);
      inspected.push(result);
    }

    // An item inside another picked folder would be trashed along with it.
    const folders = inspected.filter((r) => r.ok && r.info.kind === 'directory').map((r) => norm(r.record.path));
    const items = inspected.map((r) => {
      if (!r.ok) return r;
      const key = norm(r.record.path);
      if (folders.some((f) => isInside(key, f))) {
        return { ...failure(new FileOpError('nested')), path: r.info.path, name: r.info.name };
      }
      const token = crypto.randomUUID();
      selections.set(token, r.record);
      return { ok: true, token, info: r.info };
    });
    return { ok: true, items };
  }

  /** Single-item convenience wrapper around selectMany(). */
  async function select(input) {
    const result = await selectMany([input]);
    return result.ok ? result.items[0] : result;
  }

  /** Forget a selection (user cancelled or the file survived). */
  function release(token) {
    selections.delete(token);
    return { ok: true };
  }

  /**
   * Move the selected item to the Recycle Bin / Trash.
   * Only accepts a token issued by select()/selectMany(); tokens are single-use.
   */
  async function trash(token) {
    try {
      if (typeof token !== 'string' || !selections.has(token)) throw new FileOpError('stale-selection');
      const record = selections.get(token);
      selections.delete(token);

      assertNotProtected(record.path);

      let current;
      try {
        current = await fsp.lstat(record.path, { bigint: true });
      } catch (err) {
        throw new FileOpError(classifySystemError(err), err.message);
      }
      if (!sameIdentity(identityOf(current), record.identity)) {
        throw new FileOpError('changed', 'The item at this path is not the one you picked.');
      }

      try {
        await trashItem(record.path);
      } catch (err) {
        throw new FileOpError(classifySystemError(err), err && err.message);
      }

      // Post-condition: the exact item we picked must be gone from its location.
      try {
        const after = await fsp.lstat(record.path, { bigint: true });
        if (sameIdentity(identityOf(after), record.identity)) {
          throw new FileOpError('trash-failed', 'The item is still in its original location.');
        }
      } catch (err) {
        if (err instanceof FileOpError) throw err;
        if (err.code !== 'ENOENT') throw new FileOpError(classifySystemError(err), err.message);
      }

      return { ok: true, name: p.basename(record.path), kind: record.identity.kind };
    } catch (err) {
      return failure(err);
    }
  }

  return { select, selectMany, release, trash, _selections: selections };
}

module.exports = { createFileOps, classifySystemError, MESSAGES };
