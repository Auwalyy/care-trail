// Expo's default Metro config detects npm workspaces automatically (watch folders + node_modules
// resolution from the monorepo root), so only NativeWind needs to be layered on top.
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);

module.exports = withNativeWind(config, { input: './global.css' });
