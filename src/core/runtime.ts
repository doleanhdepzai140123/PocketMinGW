import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Project, RunResult } from './model';
interface RuntimePlugin { run(options: { request: string }): Promise<{ result: string }>; cancel(): Promise<void> }
const runtime = registerPlugin<RuntimePlugin>('PocketRuntime');
export const nativeRuntime = Capacitor.isNativePlatform();
export async function runProject(project: Project, stdin: string): Promise<RunResult> {
  const entryFile = project.buildMode === 'project' ? '' : project.active;
  if (project.buildMode !== 'project' && !/\.(cpp|cc|cxx)$/.test(entryFile)) throw new Error('Mở file C++ muốn chạy, hoặc chọn biên dịch Cả project trong Thiết lập.');
  if (!nativeRuntime) throw new Error('Bản xem trước chỉ hỗ trợ soạn thảo. Cài app Android/iOS để chạy compiler thông dịch offline.');
  const { result } = await runtime.run({ request: JSON.stringify({ files: project.files, entryFile, stdin, timeLimitMs: project.timeLimitMs, inputFile: project.inputFile, outputFile: project.outputFile }) });
  const parsed: RunResult = JSON.parse(result);
  if (parsed.error && /duplicate symbol: (?:__original_main|main)\b/.test(parsed.buildLog)) {
    parsed.error = 'Có nhiều file cùng định nghĩa main(). Chọn File đang mở trong Thiết lập để chạy từng lời giải riêng.';
  }
  return parsed;
}
export async function stopProgram() { if (nativeRuntime) await runtime.cancel(); }
