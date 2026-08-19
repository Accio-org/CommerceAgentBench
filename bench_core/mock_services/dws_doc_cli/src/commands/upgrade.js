'use strict';

function register(registerCommand) {
  registerCommand('upgrade', handleUpgrade);
}

function handleUpgrade(args, flags, state) {
  const hasCheck = args.includes('--check');
  const hasList = args.includes('--list');
  const hasRollback = args.includes('--rollback');
  const versionIdx = args.indexOf('--version');
  const targetVersion = versionIdx !== -1 ? args[versionIdx + 1] : null;

  if (hasCheck) {
    return {
      success: true,
      result: {
        currentVersion: 'v1.0.28',
        latestVersion: 'v1.0.28',
        updateAvailable: false,
        message: 'You are already on the latest version.'
      }
    };
  }

  if (hasList) {
    return {
      success: true,
      result: {
        versions: [
          { version: 'v1.0.28', date: '2025-05-28', current: true, changelog: 'Bug fixes and performance improvements' },
          { version: 'v1.0.27', date: '2025-05-20', current: false, changelog: 'Doc command behavior improvements' },
          { version: 'v1.0.26', date: '2025-05-12', current: false, changelog: 'Smart input correction improvements' },
          { version: 'v1.0.25', date: '2025-05-01', current: false, changelog: 'Doc schema discovery improvements' },
          { version: 'v1.0.24', date: '2025-04-20', current: false, changelog: 'Mock harness integration improvements' }
        ]
      }
    };
  }

  if (hasRollback) {
    return {
      success: true,
      result: {
        message: 'Rolled back to previous version',
        previousVersion: 'v1.0.28',
        currentVersion: 'v1.0.27'
      }
    };
  }

  if (targetVersion) {
    return {
      success: true,
      result: {
        message: `Upgraded to ${targetVersion}`,
        previousVersion: 'v1.0.28',
        currentVersion: targetVersion
      }
    };
  }

  return {
    success: true,
    result: {
      currentVersion: 'v1.0.28',
      latestVersion: 'v1.0.28',
      updateAvailable: false,
      message: 'Already on latest version v1.0.28'
    }
  };
}

module.exports = { register };
