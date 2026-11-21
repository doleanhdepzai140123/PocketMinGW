import { beforeEach, expect, test, vi } from 'vitest';
import { initialWorkspace } from '../src/core/templates';
const disk = vi.hoisted(() => new Map<string,string>());
vi.mock('@capacitor/filesystem',()=>({Directory:{Documents:'docs',Data:'data'},Encoding:{UTF8:'utf8'},Filesystem:{
  mkdir: async()=>{},
  readdir: async()=>({files:[...disk.keys()].filter(p=>/^PocketMinGW\/[^/]+$/.test(p)).map(p=>({name:p.split('/').pop()}))}),
  readFile: async({path}:{path:string})=>{if(!disk.has(path))throw Error('missing');return {data:disk.get(path)};},
  writeFile: async({path,data}:{path:string;data:string})=>{disk.set(path,data);},
  deleteFile: async({path}:{path:string})=>{disk.delete(path);},
}}));
vi.mock('@capacitor/core',()=>({Capacitor:{getPlatform:()=> 'ios',isNativePlatform:()=>true}}));
import {loadWorkspace,saveWorkspace} from '../src/core/storage';
beforeEach(()=>disk.clear());
test('autosave keeps the latest backup and removes renamed files after commit',async()=>{
  const w=initialWorkspace();await saveWorkspace(w);const p=w.projects[0],old=p.files[0].path;
  p.files[0].path='renamed.cpp';p.active='renamed.cpp';p.tabs=['renamed.cpp'];await saveWorkspace(w);
  expect(disk.has(`PocketMinGW/projects/${p.id}/${old}`)).toBe(false);
  p.files[0].content='int main(){return 42;}';await saveWorkspace(w);
  expect(JSON.parse(disk.get('PocketMinGW/workspace.backup.json')!).projects[0].files[0].path).toBe('renamed.cpp');
  expect((await loadWorkspace()).projects[0].files[0].content).toBe(p.files[0].content);
});
test('an interrupted commit recovers its complete pending journal',async()=>{
  const w=initialWorkspace();await saveWorkspace(w);w.projects[0].name='Recovered';
  disk.set('PocketMinGW/workspace.pending.json',JSON.stringify(w));disk.set('PocketMinGW/workspace.json','{partial');
  expect((await loadWorkspace()).projects[0].name).toBe('Recovered');
});
test('corrupt copies never silently reset user work',async()=>{
  disk.set('PocketMinGW/workspace.json','broken');
  await expect(loadWorkspace()).rejects.toThrow('Không đọc được');
  expect(disk.get('PocketMinGW/workspace.json')).toBe('broken');
});
