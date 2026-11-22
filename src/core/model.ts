export interface SourceFile { path: string; content: string }
export interface TestCase { id: string; name: string; input: string; expected: string }
export interface Project {
  id: string; name: string; files: SourceFile[]; tabs: string[]; active: string;
  stdin: string; tests: TestCase[]; inputFile: string; outputFile: string; timeLimitMs: number;
  buildMode: 'active' | 'project';
}
export interface Workspace { version: 1; projects: Project[]; activeProject: string; fontSize: number; wrap: boolean }
export interface RunResult { buildLog: string; stdout: string; error: string; exitCode: number; phase: string; runMs: number; compileMs: number; files?: Record<string,string>; engine: string }
export interface Diagnostic { file: string; line: number; column: number; message: string; severity: string }
export function cloneProject(p: Project): Project {
  return { ...p, files: p.files.map(f => ({ ...f })), tabs: [...p.tabs], tests: p.tests.map(t => ({ ...t })) };
}
export function validPath(path: string): string {
  const clean = path.trim();
  if (!clean || clean.length > 200 || /[\\:\x00-\x1f]/.test(clean) || clean.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Tên file không hợp lệ. Dùng đường dẫn như src/main.cpp.');
  if (/^(include\/|lib\/|\.pocket)/.test(clean)) throw new Error('Đường dẫn này dành riêng cho compiler.');
  return clean;
}
export function parseDiagnostics(log: string): Diagnostic[] {
  return log.split('\n').flatMap(line => {
    const m = line.match(/^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.+)$/);
    return m ? [{ file: m[1], line: +m[2], column: +m[3], severity: m[4], message: m[5] }] : [];
  });
}
export function compareOutput(actual: string, expected: string, mode: 'tokens' | 'exact' = 'tokens') {
  const normalized = (s: string) => mode === 'exact' ? s.replace(/\r\n/g, '\n') : s.trim().split(/\s+/).filter(Boolean).join(' ');
  return normalized(actual) === normalized(expected);
}
export function renameFile(p: Project, before: string, after: string): Project {
  after = validPath(after);
  if (p.files.some(f => f.path === after && f.path !== before)) throw new Error('File này đã tồn tại.');
  return { ...p, files: p.files.map(f => f.path === before ? { ...f, path: after } : f), tabs: p.tabs.map(t => t === before ? after : t), active: p.active === before ? after : p.active };
}
export function removeFile(p: Project, path: string): Project {
  const files = p.files.filter(f => f.path !== path), tabs = p.tabs.filter(t => t !== path);
  return { ...p, files, tabs, active: p.active === path ? tabs[0] ?? '' : p.active };
}
export function validateWorkspace(value: unknown): Workspace {
  const w = value as Workspace;
  if (!w || w.version !== 1 || !Array.isArray(w.projects) || w.projects.length > 100) throw new Error('Dữ liệu workspace không hợp lệ.');
  for (const p of w.projects) {
    if (!p || typeof p.id !== 'string' || !/^[\w-]+$/.test(p.id) || typeof p.name !== 'string' || !Array.isArray(p.files) || p.files.length > 100) throw new Error('Project không hợp lệ.');
    const paths = new Set<string>();
    for (const f of p.files) { validPath(f.path); if (typeof f.content !== 'string' || f.content.length > 2 * 1024 * 1024 || paths.has(f.path)) throw new Error('File trùng hoặc quá lớn.'); paths.add(f.path); }
    p.tabs = Array.isArray(p.tabs) ? [...new Set(p.tabs.filter(t => paths.has(t)))] : [];
    p.active = paths.has(p.active) ? p.active : p.tabs[0] ?? '';
    p.tests = Array.isArray(p.tests) ? p.tests.filter(t => t && typeof t.input === 'string' && typeof t.expected === 'string').slice(0, 50) : [];
    p.stdin = typeof p.stdin === 'string' ? p.stdin : '';
    p.inputFile = typeof p.inputFile === 'string' ? p.inputFile : '';
    p.outputFile = typeof p.outputFile === 'string' ? p.outputFile : '';
    p.timeLimitMs = Math.min(30000, Math.max(100, Number(p.timeLimitMs) || 3000));
    p.buildMode = p.buildMode === 'project' ? 'project' : 'active';
  }
  if (!w.projects.some(p => p.id === w.activeProject)) w.activeProject = w.projects[0]?.id ?? '';
  w.fontSize = Math.min(24, Math.max(16, Number(w.fontSize) || 16)); w.wrap = Boolean(w.wrap);
  return w;
}
