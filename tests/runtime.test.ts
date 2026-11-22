import { beforeEach, expect, test, vi } from 'vitest';
import { newProject } from '../src/core/templates';
const bridge = vi.hoisted(() => ({run: vi.fn(), cancel: vi.fn()}));
vi.mock('@capacitor/core', () => ({Capacitor: {isNativePlatform: () => true}, registerPlugin: () => bridge}));
import { runProject } from '../src/core/runtime';
beforeEach(() => { bridge.run.mockReset(); bridge.run.mockResolvedValue({result: JSON.stringify({error:'',buildLog:'',stdout:'42'})}); });
test('the active-file request keeps other files available without compiling their main functions', async () => {
  const p = newProject('HSG'); p.files.push({path:'solution.cpp',content:'int main(){}'}); p.active='solution.cpp';
  await runProject(p,'Hello!');
  const request=JSON.parse(bridge.run.mock.calls[0][0].request);
  expect(request.entryFile).toBe('solution.cpp'); expect(request.files).toEqual(p.files); expect(request.stdin).toBe('Hello!');
  p.buildMode='project'; await runProject(p,'');
  expect(JSON.parse(bridge.run.mock.calls[1][0].request).entryFile).toBe('');
});
test('duplicate main gives a useful explanation and retains the original linker log', async () => {
  const log='wasm-ld: error: duplicate symbol: __original_main';
  bridge.run.mockResolvedValue({result:JSON.stringify({error:'Linking failed',buildLog:log})});
  const result=await runProject(newProject('HSG'),'');
  expect(result.error).toContain('File đang mở'); expect(result.buildLog).toBe(log);
});
