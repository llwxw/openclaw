/**
 * Memory Bootstrap Hook for OpenClaw
 *
 * Fires on agent:bootstrap event before workspace files are injected.
 * Injects MEMORY.md + recent session summaries as virtual bootstrap files.
 */

const handler = async (event) => {
  // Safety checks for event structure
  if (!event || typeof event !== 'object') return;
  if (event.type !== 'agent' || event.action !== 'bootstrap') return;
  if (!event.context || typeof event.context !== 'object') return;
  if (!Array.isArray(event.context.bootstrapFiles)) return;

  const workspaceDir = event.context.workspaceDir || process.env.OPENCLAW_WORKSPACE_DIR;
  if (!workspaceDir) return;

  const memoryRoot = `${workspaceDir}/memory`;
  const memoryMdPath = `${workspaceDir}/MEMORY.md`;

  // Read MEMORY.md (long-term memory index)
  try {
    const { readFile } = await import('node:fs/promises');
    const memoryContent = await readFile(memoryMdPath, 'utf-8').catch(() => null);
    if (memoryContent) {
      event.context.bootstrapFiles.push({
        path: 'MEMORY.md',
        content: memoryContent.slice(0, 2000),
        virtual: true,
      });
    }
  } catch { /* skip */ }

  // Read recent session summaries from memory/
  try {
    const { readdir, readFile } = await import('node:fs/promises');
    const files = await readdir(memoryRoot);
    const summaryFiles = files
      .filter(f => (f.includes('summary') || f.match(/\d{4}-\d{2}-\d{2}/)) && f.endsWith('.md'))
      .filter(f => !f.startsWith('MEMORY'))
      .sort()
      .reverse()
      .slice(0, 3);

    for (const file of summaryFiles) {
      try {
        const content = await readFile(`${memoryRoot}/${file}`, 'utf-8');
        if (content.includes('<!-- summary-only -->') && content.length < 2000) {
          event.context.bootstrapFiles.push({
            path: `memory/${file}`,
            content,
            virtual: true,
          });
        } else if (!content.includes('<!-- summary-only -->')) {
          event.context.bootstrapFiles.push({
            path: `memory/${file}`,
            content: content.slice(0, 1000),
            virtual: true,
          });
        }
      } catch { /* skip individual file errors */ }
    }
  } catch { /* skip directory errors */ }
};

export default handler;
module.exports = handler;
module.exports.default = handler;
