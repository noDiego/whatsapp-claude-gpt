import *  as  winston from 'winston';
import { getFormattedDate } from './utils';

const logFormat = winston.format.printf(function(info) {
  return `${getFormattedDate()}-${info.level}: ${JSON.stringify(info.message, null, 4)}`;
});

const logger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat)
    })
  ]
});

export function setLogLevel(level: 'error' | 'warn' | 'info' | 'debug' | 'silly'){
  logger.level = level.toLocaleLowerCase();
}

export default logger;
