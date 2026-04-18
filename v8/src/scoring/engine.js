/**
 * OpenClaw v8.0 独立评分引擎
 * 基于任务描述和上下文，计算复杂度分数并决定执行策略
 */

/**
 * 评分因子定义
 */
const FACTOR_DEFINITIONS = {
 logic: {
 max: 3,
 patterns: [
 { weight: 2, regex: /重构|refactor|重写|rewrite|重新设计|redesign/ },
 { weight: 2, regex: /抽象|abstract|架构|architecture|模块化|modularize/ },
 { weight: 2, regex: /递归|recursion|算法优化|algorithm|复杂度|complexity/ },
 { weight: 1, regex: /多个文件|多文件|multi[ -]file|跨模块|cross[ -]module/ },
 { weight: 1, regex: /条件分支|if[ -]else|switch|循环|loop|嵌套|nested/ },
 { weight: 1, regex: /正则|regex|状态机|state machine/ },
 ]
 },
 risk: {
 max: 3,
 patterns: [
 { weight: 3, regex: /删除|delete|rm|remove|清空|clear|销毁|destroy|卸载|uninstall/ },
 { weight: 3, regex: /数据库|database|drop|truncate|迁移|migration|备份|backup/ },
 { weight: 2, regex: /修改权限|chmod|chown|sudo|root|系统|system|内核|kernel/ },
 { weight: 2, regex: /生产环境|production|线上|敏感|secret|token|密码|password/ },
 { weight: 1, regex: /覆盖|overwrite|强制|force|批量|batch|递归删除|recursive delete/ },
 { weight: 1, regex: /网络请求|curl|wget|下载|download|上传|upload/ },
 ]
 },
 duration: {
 max: 3,
 patterns: [
 { weight: 3, regex: /编译|compile|构建|build|打包|package|bundle/ },
 { weight: 3, regex: /安装.*依赖|install.*dep|npm install|yarn add|pip install|cargo build|go mod/ },
 { weight: 2, regex: /测试|test|运行测试|run test|覆盖率|coverage/ },
 { weight: 2, regex: /下载|download|拉取|fetch|clone|克隆/ },
 { weight: 1, regex: /扫描|scan|分析|analyze|检查|check|lint/ },
 { weight: 1, regex: /大量文件|large|许多|many|全部|all/ },
 ]
 },
 resource: {
 max: 3,
 patterns: [
 { weight: 3, regex: /训练|train|模型|model|推理|inference|GPU|CUDA/ },
 { weight: 2, regex: /视频|video|图像|image|处理|process|转换|convert/ },
 { weight: 2, regex: /大数据|big data|GB|TB|日志|log|海量|massive/ },
 { weight: 1, regex: /多进程|parallel|并发|concurrent|多线程|thread/ },
 { weight: 1, regex: /索引|index|压缩|compress|解压|extract/ },
 ]
 },
 uncertainty: {
 max: 3,
 patterns: [
 { weight: 3, regex: /API|接口|请求|request|响应|response|HTTP/ },
 { weight: 2, regex: /外部|external|第三方|third[ -]party|依赖服务|service/ },
 { weight: 2, regex: /网络|network|连接|connect|超时|timeout|重试|retry/ },
 { weight: 1, regex: /可能|maybe|或许|尝试|try|探索|explore|不确定|uncertain/ },
 { weight: 1, regex: /调试|debug|排查|troubleshoot|修复|fix/ },
 ]
 },
 dependency: {
 max: 3,
 patterns: [
 { weight: 3, regex: /monorepo|多包|workspace|工作区|子项目|submodule/ },
 { weight: 2, regex: /多个依赖|多依赖|依赖关系|dependency graph/ },
 { weight: 2, regex: /微服务|microservice|服务网格|service mesh/ },
 { weight: 1, regex: /第三方库|library|框架|framework|插件|plugin/ },
 { weight: 1, regex: /前后端|frontend.*backend|全栈|full[ -]stack/ },
 ]
 }
};

/**
 * 平方根归一化函数（方案一）
 * rawScore 范围 0-18 → 映射到 0-100
 * 使用平方根曲线让低分增长更快
 */
function normalizeScore(rawScore) {
 const normalized = Math.round(Math.sqrt(rawScore / 18) * 100);
 return Math.min(100, normalized);
}

/**
 * 根据任务描述和上下文计算单个因子的分数
 */
function calculateFactor(text, context, factorDef) {
 let score = 0;
 for (const pattern of factorDef.patterns) {
 if (pattern.regex.test(text)) {
 score = Math.max(score, pattern.weight);
 }
 }
 // 上下文增强
 if (factorDef === FACTOR_DEFINITIONS.logic && context.fileCount > 10) {
 score = Math.max(score, 2);
 }
 if (factorDef === FACTOR_DEFINITIONS.duration && context.estimatedLines > 1000) {
 score = Math.max(score, 2);
 }
 return Math.min(score, factorDef.max);
}

/**
 * 主评分函数
 */
function scoreTask(prompt, context = {}) {
 const text = prompt.toLowerCase();
 const factors = {};
 let totalScore = 0;

 for (const [name, def] of Object.entries(FACTOR_DEFINITIONS)) {
 const factorScore = calculateFactor(text, context, def);
 factors[name] = factorScore;
 totalScore += factorScore;
 }

 // 使用平方根归一化
 const normalizedScore = normalizeScore(totalScore);
 
 const { strategy, timeout } = selectStrategy(normalizedScore, factors);

 return {
 score: normalizedScore,
 factors,
 recommendedStrategy: strategy,
 timeout
 };
}

/**
 * 根据分数和因子选择执行策略
 */
function selectStrategy(score, factors) {
  // 特殊规则：如果风险极高，即使总分不高也要隔离执行
  if (factors.risk >= 3) {
    return { strategy: 'SPAWN_SUBAGENT', timeout: 180 };
  }
  
  // 特殊规则：资源消耗极大，使用分片并行
  if (factors.resource >= 3 || factors.cpuIntensity >= 3 || (factors.scaleIndex && factors.scaleIndex >= 4)) {
    return { strategy: 'PARALLEL_SHARDS', timeout: 300 };
  }

  // 标准分数区间
  let baseTimeout = 30;
  let strategy = 'DIRECT';
  
  if (score <= 20) {
    strategy = 'DIRECT';
    baseTimeout = 30;
  } else if (score <= 40) {
    strategy = 'STEP_ARCHIVE';
    baseTimeout = 60;
  } else if (score <= 60) {
    strategy = 'SPAWN_SUBAGENT';
    baseTimeout = 120;
  } else if (score <= 80) {
    strategy = 'PARALLEL_SHARDS';
    baseTimeout = 240;
  } else {
    strategy = 'MEGA_TASK';
    baseTimeout = 7200;
  }
  
  // 动态超时系数：基于 duration 因子
  const durationFactor = factors.duration || 0;
  const finalTimeout = Math.min(
    baseTimeout * (1 + durationFactor * 0.5),
    baseTimeout * 4
  );
  
  return { strategy, timeout: Math.round(finalTimeout) };
}

/**
 * 快速评分（仅用于意图判断）
 */
function quickScore(prompt) {
 const result = scoreTask(prompt);
 return {
 totalScore: result.score,
 factors: result.factors,
 strategy: result.recommendedStrategy,
 timeout: result.timeout
 };
}

/**
 * 意图检测：判断是任务还是闲聊
 */
function detectIntent(prompt) {
 const taskPatterns = [
 /运行|执行|run|exec|执行|构建|build|测试|test|部署|deploy/,
 /编译|compile|打包|package|安装|install|配置|config/,
 /创建|create|生成|generate|删除|delete|修改|modify|更新|update/,
 /分析|analyze|检查|check|修复|fix|重构|refactor/,
 /帮我|help|请|please|做|do|写|write/,
 ];
 
 const chatPatterns = [
 /你好|hello|hi|嘿|在吗|怎么样|如何|什么是|what is/,
 /解释|explain|介绍|introduce|谢谢|thanks|再见|bye/,
 /天气|weather|时间|time|日期|date/,
 ];

 const text = prompt.toLowerCase();
 
 for (const pattern of taskPatterns) {
 if (pattern.test(text)) return { intent: 'task', confidence: 0.8 };
 }
 for (const pattern of chatPatterns) {
 if (pattern.test(text)) return { intent: 'chat', confidence: 0.8 };
 }
 
 // 默认按任务处理
 return { intent: 'task', confidence: 0.5 };
}

module.exports = {
 scoreTask,
 quickScore,
 detectIntent
};
