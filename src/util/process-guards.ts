/**
 * Last line of defense against the whole bot going down because of one stray error. On Node 20 an
 * unhandled promise rejection terminates the process by default - one forgotten .catch() anywhere
 * (a WhatsApp send, a web request, a scheduler tick) took the WhatsApp session, the scheduler and
 * the portal down together. These handlers log it loudly instead and keep serving.
 *
 * An uncaughtException is different: the process state may genuinely be corrupt, so after logging
 * it exits and lets the supervisor (systemd Restart=on-failure / pm2) start a clean one. A
 * single-instance lock release still runs via process.on('exit') (see util/single-instance.ts).
 */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[PROCESS] Promesa rechazada sin manejar (el bot sigue funcionando):', err.stack ?? err.message);
  });

  process.on('uncaughtException', (err) => {
    console.error('[PROCESS] Excepción no capturada - reinicio limpio:', err.stack ?? err.message);
    process.exit(1);
  });

}
