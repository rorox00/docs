import { env } from './env';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
};
const RESET = '\x1b[0m';

function threshold(): number {
  const configured = (env().LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LEVELS[configured] ?? LEVELS.info;
}

function serialiseError(value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}

function emit(level: LogLevel, scope: string, message: string, meta?: Record<string, unknown>) {
  if (LEVELS[level] < threshold()) return;
  const time = new Date().toISOString();
  const cleaned = meta
    ? Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, serialiseError(v)]))
    : undefined;

  if (env().LOG_FORMAT === 'json') {
    process.stdout.write(`${JSON.stringify({ time, level, scope, message, ...cleaned })}\n`);
    return;
  }

  const extras = cleaned && Object.keys(cleaned).length ? ` ${JSON.stringify(cleaned)}` : '';
  const line = `${COLORS[level]}${level.toUpperCase().padEnd(5)}${RESET} ${time} [${scope}] ${message}${extras}\n`;
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(line);
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(scope: string): Logger;
}

export function createLogger(scope = 'app'): Logger {
  return {
    debug: (m, meta) => emit('debug', scope, m, meta),
    info: (m, meta) => emit('info', scope, m, meta),
    warn: (m, meta) => emit('warn', scope, m, meta),
    error: (m, meta) => emit('error', scope, m, meta),
    child: (sub) => createLogger(`${scope}:${sub}`),
  };
}

export const logger = createLogger('bbm');
