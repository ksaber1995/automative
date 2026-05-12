#!/usr/bin/env node
/**
 * Splits Angular components from inline template/styles into separate
 * .html / .scss files, replacing them with templateUrl / styleUrl.
 *
 * Idempotent — skips components that already use external files.
 *
 * Run with:  node scripts/split-components.mjs
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

const ROOT = new URL('../src/app/', import.meta.url).pathname.replace(/^\//, '');

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.name.endsWith('.component.ts')) out.push(full);
  }
  return out;
}

/**
 * Scan forward from a starting `\`` to find the matching closing backtick,
 * respecting `\\` escapes and `${ ... }` interpolations (which may contain
 * their own nested backticks via further template literals).
 */
function findTemplateEnd(src, start) {
  let i = start + 1;
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '$' && src[i + 1] === '{') {
      depth++;
      i += 2;
      continue;
    }
    if (depth > 0 && ch === '}') {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && ch === '`') return i;
    if (depth > 0 && ch === '`') {
      // Nested template literal inside ${ } — scan past it recursively.
      i = findTemplateEnd(src, i) + 1;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Extract a `template: \`...\`` block.
 * Returns { fullMatch, content, startIdx, endIdx } or null.
 */
function extractTemplate(src) {
  const m = src.match(/template\s*:\s*`/);
  if (!m) return null;
  const startBacktick = m.index + m[0].length - 1;
  const closeIdx = findTemplateEnd(src, startBacktick);
  if (closeIdx === -1) return null;
  return {
    content: src.slice(startBacktick + 1, closeIdx),
    fullMatch: src.slice(m.index, closeIdx + 1),
    startIdx: m.index,
    endIdx: closeIdx + 1,
  };
}

/**
 * Extract `styles: [\`...\`]` or `styles: \`...\``. Returns null if absent
 * or empty.
 */
function extractStyles(src) {
  // Array form first.
  const arrMatch = src.match(/styles\s*:\s*\[/);
  if (arrMatch) {
    let i = arrMatch.index + arrMatch[0].length;
    // Skip whitespace.
    while (/\s/.test(src[i])) i++;
    if (src[i] === ']') {
      // Empty styles: []
      // Find the closing ] including any trailing comma.
      let end = i + 1;
      // Eat trailing comma + whitespace through newline.
      const after = src.slice(end);
      const trailing = after.match(/^\s*,?\s*\n?/);
      end += trailing ? trailing[0].length : 0;
      return { empty: true, fullStart: arrMatch.index, fullEnd: end };
    }
    if (src[i] !== '`') return null; // unsupported (e.g. string literal)
    const close = findTemplateEnd(src, i);
    if (close === -1) return null;
    // Look for the closing ] after the backtick.
    let after = close + 1;
    while (/\s/.test(src[after])) after++;
    if (src[after] !== ']') return null;
    let endIdx = after + 1;
    const tail = src.slice(endIdx).match(/^\s*,?\s*\n?/);
    endIdx += tail ? tail[0].length : 0;
    return {
      content: src.slice(i + 1, close),
      fullStart: arrMatch.index,
      fullEnd: endIdx,
    };
  }

  // Plain form: styles: `...`
  const plainMatch = src.match(/styles\s*:\s*`/);
  if (plainMatch) {
    const startBacktick = plainMatch.index + plainMatch[0].length - 1;
    const close = findTemplateEnd(src, startBacktick);
    if (close === -1) return null;
    let endIdx = close + 1;
    const tail = src.slice(endIdx).match(/^\s*,?\s*\n?/);
    endIdx += tail ? tail[0].length : 0;
    return {
      content: src.slice(startBacktick + 1, close),
      fullStart: plainMatch.index,
      fullEnd: endIdx,
    };
  }
  return null;
}

function dedent(text) {
  const lines = text.split('\n');
  // Drop leading blank line.
  if (lines[0] === '' || /^\s+$/.test(lines[0])) lines.shift();
  // Drop trailing blank line.
  if (lines.length && (lines[lines.length - 1] === '' || /^\s*$/.test(lines[lines.length - 1]))) {
    lines.pop();
  }
  let min = Infinity;
  for (const l of lines) {
    if (l.trim() === '') continue;
    const m = l.match(/^( *)/);
    if (m && m[1].length < min) min = m[1].length;
  }
  if (!Number.isFinite(min)) min = 0;
  return lines.map(l => l.slice(min)).join('\n') + '\n';
}

function shouldSkip(src) {
  // Already split.
  return /templateUrl\s*:/.test(src);
}

async function processFile(path) {
  const src = await readFile(path, 'utf8');
  if (shouldSkip(src)) return { path, status: 'skipped-templateUrl' };

  const tpl = extractTemplate(src);
  if (!tpl) return { path, status: 'no-inline-template' };

  const base = basename(path, '.ts'); // foo.component
  const dir = dirname(path);
  const htmlPath = join(dir, `${base}.html`);
  await writeFile(htmlPath, dedent(tpl.content), 'utf8');

  const styles = extractStyles(src);
  let stylePath = null;
  if (styles && !styles.empty && styles.content && styles.content.trim()) {
    stylePath = join(dir, `${base}.scss`);
    await writeFile(stylePath, dedent(styles.content), 'utf8');
  }

  // Build the replacement string. We replace the template span and (if
  // present) the styles span, in descending order so indices stay valid.
  const htmlRel = `./${base}.html`;
  const scssRel = stylePath ? `./${base}.scss` : null;

  // Sort the two spans by start desc so we can splice without recomputing.
  const spans = [];
  spans.push({
    start: tpl.startIdx,
    end: tpl.endIdx,
    replacement: `templateUrl: '${htmlRel}'`,
  });
  if (styles) {
    const replacement = scssRel
      ? `styleUrl: '${scssRel}'`
      : ''; // empty/no styles → drop entirely
    spans.push({
      start: styles.fullStart,
      end: styles.fullEnd,
      replacement,
    });
  }
  spans.sort((a, b) => b.start - a.start);

  let next = src;
  for (const s of spans) {
    let before = next.slice(0, s.start);
    let after = next.slice(s.end);
    // If we're dropping styles entirely, clean up any trailing comma + blank
    // line left behind in `before`.
    let middle = s.replacement;
    if (middle === '') {
      // Eat a single preceding `,\n` if it's there so we don't leave
      // dangling commas.
      before = before.replace(/,\s*\n?\s*$/, '');
      // If `after` starts with a comma/newline, normalise leading whitespace.
      after = after.replace(/^\s*,/, ',');
    }
    next = before + middle + after;
  }

  await writeFile(path, next, 'utf8');
  return {
    path,
    status: 'split',
    html: htmlPath,
    scss: stylePath,
  };
}

const files = await walk(ROOT);
const results = [];
for (const f of files) {
  try {
    results.push(await processFile(f));
  } catch (err) {
    results.push({ path: f, status: 'error', error: err.message });
  }
}

const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});
console.log('Summary:', counts);
for (const r of results) {
  if (r.status === 'error') console.log(' ERR ', r.path, r.error);
  else if (r.status === 'split') {
    console.log(' ✓   ', r.path);
    console.log('       →', r.html);
    if (r.scss) console.log('       →', r.scss);
  }
}
