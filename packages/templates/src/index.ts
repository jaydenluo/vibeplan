export function agentsInstructions(): string {
  return `# AGENTS.md\n\nBefore working on a task, read .vibe/instructions.md and the related task file.\nUpdate task status, changed files, tests, and remaining issues before reporting completion.\n`;
}

export function projectInstructions(): string {
  return `# Vibe Plan project rules\n\n- Start work with \`vibe task start ID\`.\n- Keep code changes and task evidence together.\n- Run \`vibe check\` before committing.\n- Do not mark a task done without acceptance evidence.\n`;
}
