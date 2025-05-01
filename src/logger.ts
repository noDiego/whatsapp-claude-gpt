import *  as  winston from 'winston';
import 'winston-daily-rotate-file';

const dailyRotateFile = new (winston.transports.DailyRotateFile)({
  filename: 'logs/application-%DATE%.log',
  datePattern: 'YYYY-MM-DD-HH',
  zippedArchive: true,
  maxSize: '20m',
  maxFiles: '14d'
});

const logFormat = winston.format.printf(function(info) {
  return `${new Date().toISOString()}-${info.level}: ${JSON.stringify(info.message, null, 4)}`;
});

const logger = winston.createLogger({
  level: 'debug',
  transports: [
    dailyRotateFile,
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), logFormat)
    })
  ]
});

export default logger;
