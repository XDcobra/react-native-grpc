// Jest 26's node environment does not expose Node's global AbortController /
// AbortSignal (Jest 27+ does). React Native provides both as globals at runtime,
// and the library relies on them, so hand Node's built-ins to the test context.
/* global AbortController, AbortSignal */
const NodeEnvironment = require('jest-environment-node');

class NodeEnvironmentWithAbort extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.AbortController = AbortController;
    this.global.AbortSignal = AbortSignal;
  }
}

module.exports = NodeEnvironmentWithAbort;
