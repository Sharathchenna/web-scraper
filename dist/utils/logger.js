import winston from 'winston';
import path from 'path';
import fs from 'fs';
const LOG_DIR = './logs';
// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}
// Custom format for console output
const consoleFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.colorize(), winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
}));
// Custom format for file output
const fileFormat = winston.format.combine(winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), winston.format.json());
export function createLogger(logLevel = 'info') {
    return winston.createLogger({
        level: logLevel,
        transports: [
            // Console transport
            new winston.transports.Console({
                format: consoleFormat,
            }),
            // File transport for all logs
            new winston.transports.File({
                filename: path.join(LOG_DIR, 'importer.log'),
                format: fileFormat,
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5,
            }),
            // Separate file for errors
            new winston.transports.File({
                filename: path.join(LOG_DIR, 'error.log'),
                level: 'error',
                format: fileFormat,
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5,
            }),
        ],
    });
}
// Default logger instance
export const logger = createLogger(process.env.LOG_LEVEL || 'info');
//# sourceMappingURL=logger.js.map