import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const manifest = JSON.parse(await readFile(new URL('../toolchain.lock.json', import.meta.url), 'utf8'));
const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
let position = 0;
async function worker() {
  while (position < manifest.files.length) {
    const item = manifest.files[position++], target = path.join(root, item.path);
    try { if (sha(await readFile(target)) === item.sha256) continue; } catch {}
    const response = await fetch(item.url); if (!response.ok) throw new Error(`Download ${item.path}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha(bytes) !== item.sha256) throw new Error(`Checksum mismatch: ${item.path}`);
    await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
  }
}
await Promise.all(Array.from({length: 6}, worker));
const core = path.join(root, 'native/vendor/wasm3/source/m3_core.c');
let source = await readFile(core, 'utf8');
source = source.replace(/M3_WEAK\s+M3Result m3_Yield\s*\(\s*\)\s*\{\s*return m3Err_none;\s*\}/, 'extern M3Result pocket_yield(void);\nM3Result m3_Yield(void) { return pocket_yield(); }');
if (!source.includes('return pocket_yield();')) throw new Error('wasm3 cancellation hook did not apply');
await writeFile(core, source);
console.log(`Verified ${manifest.files.length} pinned toolchain assets. Native interpreter ready; no JIT.`);
