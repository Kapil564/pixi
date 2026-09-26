import { spawn, type ChildProcess } from 'node:child_process';

/**
 * Force-kills a child process and its process tree. Uses SIGKILL first, then
 * taskkill /f /t as a fallback to guarantee child processes are terminated.
 */
export function killProcessTree(child: ChildProcess): void {
  if (child.killed) return;
  try {
    const pid = child.pid;
    child.kill('SIGKILL');
    if (pid) {
      spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { windowsHide: true });
    }
  } catch (err) {
    console.debug('[Process Kill Warning]:', err);
  }
}