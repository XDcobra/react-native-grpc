const path = require('path');
const pak = require('../package.json');

// Autolink the library from the repository root instead of node_modules.
module.exports = {
  dependencies: {
    [pak.name]: {
      root: path.join(__dirname, '..'),
    },
  },
};
