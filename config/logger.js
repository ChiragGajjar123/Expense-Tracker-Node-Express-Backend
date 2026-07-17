import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * High-performance async logger using Pino.
 * 
 * Pino is ~30x faster than console.log because it:
 * - Writes asynchronously (doesn't block the event loop)
 * - Uses JSON serialization (fast and structured)
 * - Supports log levels to skip unnecessary work in production
 */
export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info'),

  // Only use pretty-printing in development (it has CPU overhead)
  ...(isProduction
    ? {
        // Production: raw JSON for log aggregators (ELK, Datadog, etc.)
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }),
});
