// Generate with the pinned WASM compiler, not the host's Clang version.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const run = (command, args) => {
  const result = spawnSync(command, args, {stdio:'inherit', timeout:240000});
  if(result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
};
run('cmake', ['-S','native','-B','native/build','-DCMAKE_BUILD_TYPE=Release']);
run('cmake', ['--build','native/build','--config','Release','-j','4']);
const binary = process.platform === 'win32' ? 'native/build/Release/pocket-cli.exe' : 'native/build/pocket-cli';
run(binary, ['public/toolchain','--prepare-pch','public/toolchain/stdc++.pch']);
await mkdir('artifacts', {recursive:true});
const files = ['clang.wasm','memfs.wasm','sysroot.tar','stdc++.h','stdc++.pch'];
const hashes = {};
for(const name of files) hashes[name] = createHash('sha256').update(await readFile(`public/toolchain/${name}`)).digest('hex');
await writeFile('artifacts/pch-provenance.json', JSON.stringify(hashes,null,2));
