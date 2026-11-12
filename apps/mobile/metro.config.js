const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Monorepo: watch the whole workspace and resolve packages from the root node_modules.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// Required for packages that use the "exports" field (ESM packages in the monorepo).
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: './global.css' });
