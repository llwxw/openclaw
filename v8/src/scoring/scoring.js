/**
 * OpenClaw v8.0 独立评分引擎
 * 6因子 + 平方根归一化 + 特殊规则
 * 替代 v7 依赖，生产就绪
 */

// ============================================================================
// 因子定义 (6个维度，每个0-3分)
// ============================================================================

const FACTOR_DEFINITIONS = {
 // 逻辑复杂度：重构、算法、多文件等
 logic: {
 max: 3,
 patterns: [
 { weight: 2, regex: /重构|refactor|重写|rewrite|重新设计|redesign/ },
 { weight: 2, regex: /抽象|abstract|架构|architecture|模块化|modularize/ },
 { weight: 2, regex: /递归|recursion|算法优化|算法|algorithm|复杂度|complexity/ },
 { weight: 2, regex: /写代码|写程序|生成代码|实现.*代码|programming|快速排序|归并排序|堆排序|二分查找|冒泡排序/ },
 { weight: 2, regex: /排序|查找|搜索|图|树|遍历|DFS|BFS|动态规划|dp|回溯/ },
 { weight: 2, regex: /爬虫|scraping|crawl|抓取|网页爬虫|网络爬虫|数据抓取|web crawler|spider/ },
 { weight: 2, regex: /自动化|automation|脚本|script|批处理|batch/ },
 { weight: 2, regex: /接口设计|API设计|数据流|并发|异步|async|parallel/ },
 { weight: 2, regex: /网页开发|前端|后端|全栈|frontend|backend|full.?stack/ },
 { weight: 2, regex: /数据处理|ETL|清洗|转换|transform|管道|pipeline/ },
 { weight: 1, regex: /多个文件|多文件|multi[ -]file|跨模块|cross[ -]module/ },
 { weight: 1, regex: /条件分支|if[ -]else|switch|循环|loop|嵌套|nested/ },
 { weight: 1, regex: /正则|regex|状态机|state machine/ },
 { weight: 1, regex: /分析|调查|研究|investigate|评估|evaluate|计算|compute/ },
 { weight: 1, regex: /比较|对比|评估|评估|选型|技术选型/ },
 ]
 },

 // 风险度：删除、数据库、系统修改等
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

 // 预估时长：编译、安装、测试等
 duration: {
 max: 3,
 patterns: [
 { weight: 3, regex: /编译|compile|构建|build|打包|package|bundle/ },
 { weight: 3, regex: /安装.*依赖|install.*dep|npm install|yarn add|pip install|cargo build|go mod/ },
 { weight: 2, regex: /测试|test|运行测试|run test|覆盖率|coverage/ },
 { weight: 2, regex: /下载|download|拉取|fetch|clone|克隆/ },
 { weight: 1, regex: /扫描|scan|分析|analyze|检查|check|lint/ },
 { weight: 1, regex: /大量文件|large|许多|many|全部|all/ },
 { weight: 1, regex: /整个项目|完整|全面|从头|全套|整套|一整套/ },
 { weight: 1, regex: /创建|新建|开发|搭建|构建|实现一个|写一个/ },
 ]
 },

 // 资源消耗：GPU、视频、大数据等
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

 // 不确定性：API调用、网络、调试等
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

 // 依赖复杂度：monorepo、微服务、多依赖等
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

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 计算单个因子的原始分数 (0-max)
 */
function calculateFactorScore(text, context, factorDef) {
 let score = 0;
 const lowerText = text.toLowerCase();

 for (const pattern of factorDef.patterns) {
 if (pattern.regex.test(lowerText)) {
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
 if (factorDef === FACTOR_DEFINITIONS.risk && context.isProduction) {
 score = Math.max(score, 2);
 }

 return Math.min(score, factorDef.max);
}

/**
 * 平方根归一化：原始分数 (0-18) → 0-100
 * 曲线特点：低分增长快，高分增长缓，更符合实际分布
 */
function normalizeScore(rawScore) {
 // rawScore 范围 0-18
 // 公式：sqrt(rawScore / 18) * 100
 // 0→0, 2→33, 3→41, 6→57, 9→70, 12→81, 18→100
 const normalized = Math.round(Math.sqrt(rawScore / 18) * 100);
 return Math.min(100, normalized);
}

/**
 * 策略选择 (基于归一化分数和特殊规则)
 */
function selectStrategy(normalizedScore, factors) {
 // 特殊规则 1：高风险强制隔离执行
 if (factors.risk >= 3) {
 return { strategy: 'SPAWN_SUBAGENT', timeout: 180 };
 }

 // 特殊规则 2：高资源消耗强制并行分片
 if (factors.resource >= 3) {
 return { strategy: 'PARALLEL_SHARDS', timeout: 300 };
 }

 // 特殊规则 3：高不确定性强制隔离
 if (factors.uncertainty >= 3) {
 return { strategy: 'SPAWN_SUBAGENT', timeout: 180 };
 }

 // === 组合规则：识别隐含的巨型任务 ===
 // 长耗时 + 复杂依赖 → MEGA_TASK
 if (factors.duration >= 3 && factors.dependency >= 2) {
 return { strategy: 'MEGA_TASK', timeout: 7200 };
 }
 // 高逻辑 + 长耗时 → 至少 PARALLEL_SHARDS
 if (factors.logic >= 3 && factors.duration >= 3) {
 return { strategy: 'PARALLEL_SHARDS', timeout: 300 };
 }

 // 标准分数区间
 if (normalizedScore <= 20) {
 return { strategy: 'DIRECT', timeout: 30 };
 } else if (normalizedScore <= 40) {
 return { strategy: 'STEP_ARCHIVE', timeout: 60 };
 } else if (normalizedScore <= 60) {
 return { strategy: 'SPAWN_SUBAGENT', timeout: 120 };
 } else if (normalizedScore <= 80) {
 return { strategy: 'PARALLEL_SHARDS', timeout: 240 };
 } else {
 return { strategy: 'MEGA_TASK', timeout: 7200 };
 }
}

// ============================================================================
// 公开 API
// ============================================================================

/**
 * 主评分函数
 * @param {string} prompt - 用户输入的任务描述
 * @param {Object} context - 可选的上下文信息 (fileCount, estimatedLines, isProduction)
 * @returns {Object} { score, factors, recommendedStrategy, timeout }
 */
function scoreTask(prompt, context = {}) {
 const text = prompt || '';
 const factors = {};
 let rawTotal = 0;

 // 计算各因子原始分数
 for (const [name, def] of Object.entries(FACTOR_DEFINITIONS)) {
 const factorScore = calculateFactorScore(text, context, def);
 factors[name] = factorScore;
 rawTotal += factorScore;
 }

 // 归一化到 0-100
 const normalizedScore = normalizeScore(rawTotal);

 // 选择策略和超时
 const { strategy, timeout } = selectStrategy(normalizedScore, factors);

 return {
 score: normalizedScore,
 factors,
 recommendedStrategy: strategy,
 timeout,
 // 附加原始总分供调试
 _raw: { total: rawTotal, max: 18 }
 };
}

/**
 * 快速评分 (兼容旧接口)
 */
function quickScore(prompt, context = {}) {
 const result = scoreTask(prompt, context);
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
 /运行|执行|run|exec|构建|build|测试|test|部署|deploy/,
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
 if (pattern.test(text)) {
 return { intent: 'task', confidence: 0.8 };
 }
 }
 for (const pattern of chatPatterns) {
 if (pattern.test(text)) {
 return { intent: 'chat', confidence: 0.8 };
 }
 }

 // 默认按任务处理
 return { intent: 'task', confidence: 0.5 };
}

// ============================================================================
// 导出
// ============================================================================

module.exports = {
 scoreTask,
 quickScore,
 detectIntent,
 // 导出因子定义供外部调优
 FACTOR_DEFINITIONS
};