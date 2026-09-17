// Temporary static audit: find called identifiers that are never defined in public/app.js.
import { readFileSync } from 'node:fs';

const src = readFileSync('c:/Users/91831/Documents/mesteoz/public/app.js', 'utf8');

const defined = new Set();
for (const m of src.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);
for (const m of src.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) defined.add(m[1]);
for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\(/gm)) defined.add(m[1]);
for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) defined.add(m[1]);

const globals = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function', 'new', 'await', 'async',
  'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'parseInt', 'parseFloat', 'String', 'Number', 'Boolean', 'Object', 'Array', 'JSON', 'Math', 'Date',
  'Promise', 'Map', 'Set', 'Error', 'RegExp', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
  'IntersectionObserver', 'CustomEvent', 'Event', 'FormData', 'URLSearchParams', 'resolve', 'reject',
  'describe', 'it', 'test', 'expect', 'alert', 'confirm', 'prompt', 'Intl', 'Symbol', 'WeakMap', 'BigInt'
]);

const called = new Map();
for (const m of src.matchAll(/(^|[^.\w$'"`])([A-Za-z_$][\w$]*)\s*\(/g)) {
  const name = m[2];
  if (globals.has(name) || defined.has(name)) continue;
  const line = src.slice(0, m.index).split('\n').length;
  if (!called.has(name)) called.set(name, []);
  called.get(name).push(line);
}

if (!called.size) {
  console.log('NO_UNDEFINED_CALLS');
} else {
  for (const [name, lines] of called) {
    console.log(`UNDEFINED_CALL: ${name} -> lines ${lines.join(', ')}`);
  }
}

console.log('DEFINED_FUNCTIONS:', [...defined].sort().join(', '));