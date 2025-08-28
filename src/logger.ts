import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { getFormattedDate } from './utils';

const fileLogFormat = winston.format.printf((info) => {
  return `${getFormattedDate()}-${info.level}: ${JSON.stringify(info.message, null, 4)}`;
});

const consoleLogFormat = winston.format.combine(
    winston.format.colorize(),
    fileLogFormat
);

const dailyRotateFileTransport = new winston.transports.DailyRotateFile({
  filename: 'logs/roboto-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: false,
  maxSize: '20m',
  maxFiles: '14d',
  format: fileLogFormat
});

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'debug',
  transports: [
    new winston.transports.Console({
      format: consoleLogFormat
    }),
    dailyRotateFileTransport
  ]
});

export default logger;