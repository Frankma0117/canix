import pino from 'pino';

/** Silent logger for Baileys (avoids console noise). */
export const baileysLogger = pino({ level: 'silent' });
