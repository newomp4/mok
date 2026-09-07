/** Deliberately data-only edits: JSON Pointer set/remove, no evaluated expressions or scripts. */
export function applyChanges(project, changes) {
  const safe = (value, depth = 0) => {
    if (depth > 32) throw new Error('Change value is nested too deeply.');
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Unsafe key in change value.');
      safe(child, depth + 1);
    }
  };
  const result = structuredClone(project);
  for (const change of changes) {
    safe(change.value);
    const parts = change.path.split('/').slice(1).map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    if (!change.path.startsWith('/') || !parts.length || parts.some((part) => !part || ['__proto__', 'prototype', 'constructor'].includes(part))) throw new Error('Invalid or unsafe JSON Pointer.');
    if (['id', 'version', 'createdAt', 'updatedAt'].includes(parts[0])) throw new Error('Project identity/version fields cannot be edited.');
    let current = result;
    for (const key of parts.slice(0, -1)) {
      if (!current || typeof current !== 'object' || !Object.hasOwn(current, key)) throw new Error(`Missing parent at ${change.path}. Set the parent object first.`);
      current = current[key];
    }
    if (!current || typeof current !== 'object') throw new Error('Change parent is not an object.');
    const key = parts.at(-1);
    if (Array.isArray(current)) {
      if (change.op !== 'remove' && key === '-') { current.push(structuredClone(change.value)); continue; }
      if (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= current.length) throw new Error('Array index is outside the existing array; use /- to append.');
      if (change.op === 'remove') current.splice(Number(key), 1);
      else current[Number(key)] = structuredClone(change.value);
    } else if (change.op === 'remove') { if (!Object.hasOwn(current, key)) throw new Error('Cannot remove a missing field.'); delete current[key]; }
    else current[key] = structuredClone(change.value);
  }
  // JSON parsing strips exotic prototypes, and prevents inherited fields from becoming settings.
  return JSON.parse(JSON.stringify(result));
}
