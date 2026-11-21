import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const manifest = JSON.parse(await readFile(new URL('../toolchain.lock.json', import.meta.url), 'utf8'));
const root = fileURLToPath(new URL('..', import.meta.url));
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
const execHeader = path.join(root, 'native/vendor/wasm3/source/m3_exec.h');
let execSource = await readFile(execHeader, 'utf8');
if (!execSource.includes('pocketLoopTicks')) {
  const start = execSource.indexOf('d_m3Op(Loop)');
  const end = execSource.indexOf('\n#if d_m3HasExceptionHandling', start);
  if (start < 0 || end < 0) throw new Error('Cannot locate interpreter loop');
  const original = execSource.slice(start, end);
  const patched = original.replace('m3ret_t   r;', 'm3ret_t   r;\n    uint32_t pocketLoopTicks = 0;').replace('r = nextOpImpl();', 'if ((++pocketLoopTicks & 1023) == 0) {\n            r = m3_Yield();\n            if (r) return r;\n        }\n        r = nextOpImpl();');
  if(!patched.includes('pocketLoopTicks & 1023')) throw new Error('Loop cancellation hook did not apply');
  execSource = execSource.slice(0,start) + patched + execSource.slice(end);
}
await writeFile(execHeader, execSource);
console.log(`Verified ${manifest.files.length} pinned toolchain assets. Native interpreter ready; no JIT.`);
