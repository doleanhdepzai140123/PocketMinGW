import { describe, it, expect } from 'vitest';
import { validPath, compareOutput, parseDiagnostics, renameFile, removeFile, validateWorkspace } from '../src/core/model';
import { newProject, initialWorkspace } from '../src/core/templates';
describe('Workspace boundary', () => {
  it('rejects escapes and reserved compiler paths', () => { for (const p of ['../a.cpp','/tmp/a','a/../b','a\\b','C:/a','a//b','include/bits/a','lib/x','.pocket.wasm']) expect(() => validPath(p)).toThrow(); expect(validPath('src/bài.cpp')).toBe('src/bài.cpp'); });
  it('keeps editor tabs valid after rename and deletion', () => { const p = renameFile(newProject('A'), 'main.cpp', 'src/solve.cpp'); expect(p.active).toBe('src/solve.cpp'); expect(p.tabs).toEqual(['src/solve.cpp']); const d = removeFile(p, p.active); expect(d.active).toBe(''); expect(d.tabs).toEqual([]); });
  it('refuses corrupted data instead of losing code', () => { expect(() => validateWorkspace({})).toThrow(); const w=initialWorkspace(); w.projects[0].files.push({path:'../escape',content:''}); expect(()=>validateWorkspace(w)).toThrow(); });
});
describe('HSG result checks', () => {
  it('compares tokens while preserving exact mode', () => { expect(compareOutput('1  2\r\n3\n','1\n2 3')).toBe(true); expect(compareOutput('12','1 2')).toBe(false); expect(compareOutput('1 \n','1\n','exact')).toBe(false); });
  it('extracts source location from compiler diagnostics', () => { expect(parseDiagnostics('src/main.cpp:4:9: error: missing semicolon')[0]).toEqual({file:'src/main.cpp',line:4,column:9,severity:'error',message:'missing semicolon'}); });
});
