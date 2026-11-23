import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { zipSync, strToU8, unzipSync, strFromU8 } from 'fflate';
import { validateWorkspace, validPath } from './model';
import type { Workspace, SourceFile, Project } from './model';
import { initialWorkspace } from './templates';

const directory = Capacitor.getPlatform() === 'ios' ? Directory.Documents : Directory.Data;
export const rootFolder = 'PocketMinGW';
const options = { directory, encoding: Encoding.UTF8 };
let queue = Promise.resolve();
export async function loadWorkspace(): Promise<Workspace> {
  await Filesystem.mkdir({ path: rootFolder, directory, recursive: true }).catch(() => {});
  const entries = await Filesystem.readdir({ path: rootFolder, directory });
  // A complete pending journal is newer than the manifest after an interrupted save.
  for (const name of ['workspace.pending.json','workspace.json','workspace.backup.json']) {
    if (!entries.files.some(f => f.name === name)) continue;
    try {
      const result = await Filesystem.readFile({ path: `${rootFolder}/${name}`, ...options });
      const workspace = validateWorkspace(JSON.parse(String(result.data)));
      // The manifest is a complete recovery copy. Native files remain browsable/importable.
      return workspace;
    } catch { /* Try the next intact recovery copy, without overwriting failed data. */ }
  }
  if (entries.files.some(f => f.name.startsWith('workspace.'))) throw new Error('Không đọc được dữ liệu chính hoặc bản khôi phục.');
  return initialWorkspace();
}
export function saveWorkspace(workspace: Workspace): Promise<void> {
  const serialized = JSON.stringify(workspace);
  const snapshot = validateWorkspace(JSON.parse(serialized));
  const operation = queue.catch(() => {}).then(async () => {
    let previous: Workspace | null = null;
    try { previous = validateWorkspace(JSON.parse(String((await Filesystem.readFile({ path: `${rootFolder}/workspace.json`, ...options })).data))); } catch { /* first save */ }
    // Write real project files before committing the recoverable workspace manifest.
    for (const project of snapshot.projects) {
      const folder = `${rootFolder}/projects/${project.id}`;
      await Filesystem.mkdir({ path: folder, directory, recursive: true }).catch(() => {});
      for (const file of project.files) await Filesystem.writeFile({ path: `${folder}/${validPath(file.path)}`, data: file.content, recursive: true, ...options });
    }
    await Filesystem.writeFile({ path: `${rootFolder}/workspace.pending.json`, data: serialized, ...options });
    // Keep a last-good manifest before replacing it. No workspace is reset on parse errors.
    if (previous) await Filesystem.writeFile({ path: `${rootFolder}/workspace.backup.json`, data: JSON.stringify(previous), ...options });
    await Filesystem.writeFile({ path: `${rootFolder}/workspace.json`, data: serialized, ...options });
    await Filesystem.deleteFile({ path: `${rootFolder}/workspace.pending.json`, directory });
    // Reconcile removed/renamed files only after the new manifest is durable.
    for (const p of previous?.projects ?? []) for (const f of p.files) {
      if (!snapshot.projects.some(next => next.id === p.id && next.files.some(file => file.path === f.path))) {
        await Filesystem.deleteFile({ path: `${rootFolder}/projects/${p.id}/${validPath(f.path)}`, directory }).catch(() => {});
      }
    }
    for (const p of previous?.projects ?? []) if (!snapshot.projects.some(next => next.id === p.id)) {
      // IDs were validated; remove only this project's sandbox after manifest commit.
      await Filesystem.rmdir({ path: `${rootFolder}/projects/${p.id}`, directory, recursive: true });
    }
  });
  queue = operation;
  return operation;
}
export async function exportProject(project: Project) {
  const entries: Record<string, Uint8Array> = {};
  project.files.forEach(f => { entries[validPath(f.path)] = strToU8(f.content); });
  entries['pocket-tests.json'] = strToU8(JSON.stringify({ tests: project.tests, stdin: project.stdin, inputFile: project.inputFile, outputFile: project.outputFile }, null, 2));
  const bytes = zipSync(entries), name = `PocketMinGW-${project.id.slice(0, 8)}.zip`;
  if (Capacitor.isNativePlatform()) {
    let binary = ''; for (const b of bytes) binary += String.fromCharCode(b);
    await Filesystem.writeFile({ path: `${rootFolder}/exports/${name}`, directory, data: btoa(binary), recursive: true });
    const { uri } = await Filesystem.getUri({ path: `${rootFolder}/exports/${name}`, directory });
    await Share.share({ title: project.name, url: uri });
  } else {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export async function importFiles(files: FileList): Promise<SourceFile[]> {
  const result: SourceFile[] = []; let total = 0;
  for (const file of Array.from(files)) {
    if (file.size > 10 * 1024 * 1024) throw new Error('Chỉ nhập file dưới 10 MiB.');
    if (/\.zip$/i.test(file.name)) {
      // Inspect expanded sizes before decompression to reject zip bombs.
      const unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: f => {
        if (f.name.endsWith('/')) return false;
        if (f.originalSize > 2 * 1024 * 1024 || total + f.originalSize > 20 * 1024 * 1024) throw new Error('ZIP vượt giới hạn 20 MiB sau giải nén.');
        total += f.originalSize; validPath(f.name); return true;
      }});
      for (const [path, data] of Object.entries(unpacked)) result.push({ path, content: strFromU8(data) });
    } else { total += file.size; if (file.size > 2 * 1024 * 1024 || total > 20 * 1024 * 1024) throw new Error('File quá lớn.'); result.push({ path: validPath(file.name), content: await file.text() }); }
    if (result.length > 100) throw new Error('Tối đa 100 file trong một project.');
  }
  return result;
}
