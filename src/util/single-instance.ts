import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { env } from '../config/env.js';

const lockPath = join(dirname(resolve(process.cwd(), env.db.path)), 'canix.lock');

/** True if a process with this pid is alive (works cross-platform: signal 0 sends nothing, just checks). */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Refuses to start a second canix process against the same database/WhatsApp session. Two live
 * instances both running a TaskScheduler on the same SQLite file is a real-world way to get the
 * same reminder sent twice (each instance's scheduler independently sees the same due row) - this
 * was one of the suspected causes behind "the same notification arrives more than once" reports
 * that the in-process re-entrancy guard (see scheduler/task-scheduler.ts) can't catch, since that
 * guard only protects a single process against itself. Call once at boot, before anything else
 * starts; exits the process immediately if another instance already holds the lock.
 */
export function acquireSingleInstanceLock(): void {
  mkdirSync(dirname(lockPath), { recursive: true });

  if (existsSync(lockPath)) {
    const existingPid = Number(readFileSync(lockPath, 'utf8').trim());
    if (existingPid && isAlive(existingPid)) {
      console.error(
        '[LOCK] Ya hay otra instancia de canix corriendo (pid %d) sobre la misma base de datos (%s). ' +
          'No arranco una segunda para no duplicar envíos - ciérrala primero.',
        existingPid,
        env.db.path,
      );
      process.exit(1);
    }
    // Stale lock (process no longer alive, e.g. a previous crash) - safe to take over.
  }

  writeFileSync(lockPath, String(process.pid), 'utf8');

  const release = () => {
    try {
      if (Number(readFileSync(lockPath, 'utf8').trim()) === process.pid) unlinkSync(lockPath);
    } catch {
      /* already gone, nothing to clean up */
    }
  };
  process.on('exit', release);
  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}
