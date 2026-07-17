import pino from 'pino';

const isProduction = process.env.NODE_ENV === 'production';

// Detect serverless environments (Vercel, AWS Lambda, GCP Functions)
const isServerless = !!(
  process.env.VERCEL ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.FUNCTION_NAME
);

/**
 * High-performance async logger using Pino.
 * 
 * In production or serverless: uses plain JSON output (no Worker threads).
 * Locally with LOG_PRETTY=true: uses pino-pretty for colored dev output.
 * 
 * pino-pretty uses Worker threads which crash Vercel serverless functions,
 * so it's only enabled when explicitly opted in via LOG_PRETTY=true.
 */
const usePrettyPrint =
  !isProduction &&
  !isServerless &&
  process.env.LOG_PRETTY === 'true';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'warn' : 'info'),

  ...(usePrettyPrint
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {
        // Safe default: JSON output, no Worker threads
        formatters: {
          level(label) {
            return { level: label };
          },
        },
        timestamp: pino.stdTimeFunctions.isoTime,
      }),
});
