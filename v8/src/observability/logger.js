const pino = require('pino');
const path = require('path');
const fs = require('fs');

function createLogger(config) {
  const level = config.logging.level;
  const format = config.logging.format;
  const logFile = config.logging.file;

  const streams = [];
  if (logFile) {
    const dir = path.dirname(logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    streams.push({ stream: fs.createWriteStream(logFile, { flags: 'a' }) });
  }
  streams.push({ stream: process.stdout });

  const logger = pino({
    level,
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  }, pino.multistream(streams));

  return logger;
}

module.exports = { createLogger };
