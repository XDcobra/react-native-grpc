const path = require('path');
const pak = require('../package.json');

module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    [
      'module-resolver',
      {
        extensions: ['.js', '.ts', '.json', '.jsx', '.tsx'],
        // Use the library source from the repository root.
        alias: { [pak.name]: path.join(__dirname, '..', pak.source) },
      },
    ],
  ],
};
