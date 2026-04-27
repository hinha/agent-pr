/**
 * Mock for @flagsmith/flagsmith
 * Used by flagsmithSyncService for remote configuration
 */

class MockFlagsmith {
  constructor(options = {}) {
    this.options = options;
    this.environmentFlags = {};
    this.traits = new Map();
  }

  // Mock init method
  init = jest.fn().mockImplementation(async (options) => {
    this.options = { ...this.options, ...options };
    return Promise.resolve(this);
  });

  // Mock getEnvironmentFlags method
  getEnvironmentFlags = jest.fn().mockImplementation(async () => {
    return Promise.resolve({
      flags: this.environmentFlags
    });
  });

  // Mock getIdentity method
  getIdentity = jest.fn().mockImplementation(async (identifier) => {
    return Promise.resolve({
      identifier,
      traits: this.traits.get(identifier) || {}
    });
  });

  // Mock setTrait method
  setTrait = jest.fn().mockImplementation(async (identity, key, value) => {
    if (!this.traits.has(identity)) {
      this.traits.set(identity, {});
    }
    this.traits.get(identity)[key] = value;
    return Promise.resolve(true);
  });

  // Mock hasFeature method
  hasFeature = jest.fn().mockImplementation((featureName) => {
    const flag = this.environmentFlags[featureName];
    return flag ? flag.enabled : false;
  });

  // Mock getValue method
  getValue = jest.fn().mockImplementation((featureName) => {
    const flag = this.environmentFlags[featureName];
    return flag ? flag.value : null;
  });

  // Helper to set mock flags for tests
  __setFlags = function(flags) {
    this.environmentFlags = flags;
  };

  // Helper to set mock traits for tests
  __setTraits = function(identifier, traits) {
    this.traits.set(identifier, traits);
  };

  // Reset all mocks
  __resetMocks = function() {
    this.init.mockClear();
    this.getEnvironmentFlags.mockClear();
    this.getIdentity.mockClear();
    this.setTrait.mockClear();
    this.hasFeature.mockClear();
    this.getValue.mockClear();
    this.environmentFlags = {};
    this.traits.clear();
  };
}

// Export both the class and a default instance
module.exports = MockFlagsmith;
module.exports.default = MockFlagsmith;
