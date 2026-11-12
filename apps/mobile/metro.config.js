const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const fs = require('fs');
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

/**
 * Workspace packages (@caretrail/*) are resolved straight to their folder under `packages/`,
 * instead of through the links in node_modules. On Windows, terminals such as VS Code's start
 * Node with a lowercase drive letter ("c:\..."), while the links resolve to "C:\..."; Metro
 * compares paths case-sensitively, so a linked package would look unwatched and fail to resolve.
 * Building the path from `workspaceRoot` keeps the drive letter consistent with everything else.
 */
const workspacePackages = new Map(
  fs
    .readdirSync(path.join(workspaceRoot, 'packages'))
    .map((dir) => path.join(workspaceRoot, 'packages', dir))
    .filter((dir) => fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      return [pkg.name, path.join(dir, pkg.main ?? 'index.js')];
    }),
);
const upstreamResolve = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const entry = workspacePackages.get(moduleName);
  if (entry) return { type: 'sourceFile', filePath: entry };
  return (upstreamResolve ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = withNativeWind(config, { input: './global.css' });
