import { Capacitor, registerPlugin } from '@capacitor/core';
import type { Project, RunResult } from './model';
interface RuntimePlugin { run(options: { request: string }): Promise<{ result: string }>; cancel(): Promise<void> }
const runtime = registerPlugin<RuntimePlugin>('PocketRuntime');
export const nativeRuntime = Capacitor.isNativePlatform();
export async function runProject(project: Project, stdin: string): Promise<RunResult> {
  if (!nativeRuntime) throw new Error('Bản xem trước chỉ hỗ trợ soạn thảo. Cài app Android/iOS để chạy compiler thông dịch offline.');
  const { result } = await runtime.run({ request: JSON.stringify({ files: project.files, stdin, timeLimitMs: project.timeLimitMs, inputFile: project.inputFile, outputFile: project.outputFile }) });
  return JSON.parse(result);
}
export async function stopProgram() { if (nativeRuntime) await runtime.cancel(); }
