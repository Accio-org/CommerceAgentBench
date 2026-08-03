'use strict';

function register(registerCommand) {
  registerCommand('skill', handleSkill);
  registerCommand('skill setup', handleSkillSetup);
}

function handleSkill(args, flags, state) {
  if (args[0] === 'setup') return handleSkillSetup(args.slice(1), flags, state);
  return {
    success: true,
    result: {
      message: 'Skill management commands',
      available: ['setup'],
      usage: 'dws skill setup [--mode mono|multi] [--target all|claude|cursor|codex|opencode|qoder] [--yes]'
    }
  };
}

function handleSkillSetup(args, flags, state) {
  const modeIdx = args.indexOf('--mode');
  const mode = modeIdx !== -1 ? args[modeIdx + 1] : 'mono';
  const targetIdx = args.indexOf('--target');
  const target = targetIdx !== -1 ? args[targetIdx + 1] : 'all';

  const targets = target === 'all'
    ? ['claude', 'cursor', 'codex', 'opencode', 'qoder']
    : [target];

  return {
    success: true,
    result: {
      message: `Skills installed successfully (${mode} mode)`,
      mode,
      targets,
      installed: targets.map(t => ({
        agent: t,
        path: `~/.${t}/skills/dws`,
        status: 'installed'
      }))
    }
  };
}

module.exports = { register };
