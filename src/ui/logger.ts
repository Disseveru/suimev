import pino from 'pino';
import { CONFIG } from '../config/index.js';

export const REDACTION_PATHS = [
  'CDP_API_KEY',
  'CDP_API_SECRET',
  'CDP_WALLET_SECRET',
  'operatorKeypair',
  'privateKey',
  'secret',
  'password',
  'token',
  '*.CDP_API_KEY',
  '*.CDP_API_SECRET',
  '*.CDP_WALLET_SECRET',
  '*.operatorKeypair',
  '*.privateKey',
  '*.secret',
  '*.password',
  '*.token',
  'SUI_PRIVATE_KEY',
  '*.SUI_PRIVATE_KEY',
];

export const logger = pino({
  level: CONFIG.logLevel || 'info',
  redact: {
    paths: REDACTION_PATHS,
    censor: '[REDACTED_SECRET]',
  },
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
