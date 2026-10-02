import pino from 'pino';
import { CONFIG } from '../config/index.js';

export const logger = pino({
  level: CONFIG.logLevel || 'info',
  serializers: {
    err: pino.stdSerializers.err,
    error: pino.stdSerializers.err,
  },
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: 'pid,hostname',
    },
  },
});
