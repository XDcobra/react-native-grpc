const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const pak = require('../package.json');

const root = path.resolve(__dirname, '..');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Peer dependencies must be loaded once, from the example's node_modules:
// the repository root has its own (older) copies for Jest and typechecking.
const peers = Object.keys(pak.peerDependencies);

/** @type {import('@react-native/metro-config').MetroConfig} */
const config = {
  watchFolders: [root],
  resolver: {
    blockList: peers.map(
      (m) => new RegExp(`^${escape(path.join(root, 'node_modules', m))}\\/.*$`)
    ),
    extraNodeModules: Object.fromEntries(
      peers.map((m) => [m, path.join(__dirname, 'node_modules', m)])
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
