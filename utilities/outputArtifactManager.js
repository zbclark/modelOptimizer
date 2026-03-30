const { buildArtifactPath } = require('./outputPaths');

class OutputArtifactManager {
  constructor(defaults = {}) {
    this.defaults = { ...defaults };
  }

  withDefaults(overrides = {}) {
    return new OutputArtifactManager({ ...this.defaults, ...overrides });
  }

  buildPath(options = {}) {
    return buildArtifactPath({
      ...this.defaults,
      ...options
    });
  }
}

module.exports = { OutputArtifactManager };
