const fs = require('fs');
const path = require('path');
const yaml = require('yaml');

function loadConfig() {
  const env = process.env.NODE_ENV || 'development';
  const defaultPath = path.join(__dirname, '../config/default.yaml');
  const envPath = path.join(__dirname, `../config/${env}.yaml`);

  const defaultConfig = yaml.parse(fs.readFileSync(defaultPath, 'utf8'));
  let envConfig = {};
  if (fs.existsSync(envPath)) {
    envConfig = yaml.parse(fs.readFileSync(envPath, 'utf8'));
  }

  const config = deepMerge(defaultConfig, envConfig);

  // 环境变量覆盖
  if (process.env.PORT) config.server.port = parseInt(process.env.PORT);
  if (process.env.DB_PATH) config.database.path = process.env.DB_PATH;
  if (process.env.LOG_LEVEL) config.logging.level = process.env.LOG_LEVEL;

  // 确保目录存在
  ensureDir(path.dirname(config.database.path));
  ensureDir(config.executor.workspaceRoot);
  ensureDir(path.dirname(config.logging.file));

  return config;
}

function deepMerge(target, source) {
  for (const key in source) {
    if (source[key] instanceof Object && key in target) {
      Object.assign(source[key], deepMerge(target[key], source[key]));
    }
  }
  return { ...target, ...source };
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { loadConfig };
