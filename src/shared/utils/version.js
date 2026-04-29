/**
 * Version utility for getting application version information
 *
 * Version priority:
 * 1. Baked-in version from build (VERSION_FILE)
 * 2. GIT_TAG environment variable (set during CI/CD build)
 * 3. BUILD_VERSION environment variable
 * 4. package.json version
 * 5. git describe (fallback during development)
 */

const fs = require('fs');
const path = require('path');
const packageJson = require('../../../package.json');

// Version file generated during build
const VERSION_FILE = path.join(__dirname, '../../../.version.json');

/**
 * Get baked-in version from build
 * @returns {string|null} Baked version or null
 */
function getBakedVersion() {
  try {
    if (fs.existsSync(VERSION_FILE)) {
      const versionData = JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
      return versionData;
    }
  } catch {
    // File doesn't exist or invalid JSON
  }
  return null;
}

/**
 * Get application version
 * @returns {string} Version string
 */
function getVersion() {
  // 1. Check for baked version from build
  const bakedVersion = getBakedVersion();
  if (bakedVersion && bakedVersion.version) {
    return bakedVersion.version;
  }

  // 2. Check for GIT_TAG env var (set during CI build from git tag)
  if (process.env.GIT_TAG) {
    return process.env.GIT_TAG;
  }

  // 3. Check for BUILD_VERSION env var (custom build version)
  if (process.env.BUILD_VERSION) {
    return process.env.BUILD_VERSION;
  }

  // 4. Fall back to package.json version
  return packageJson.version;
}

/**
 * Get full version info object
 * @returns {Object} Version information
 */
function getVersionInfo() {
  const bakedVersion = getBakedVersion();

  // Use baked version info if available
  if (bakedVersion) {
    return {
      version: bakedVersion.version || packageJson.version,
      isTag: bakedVersion.isTag || false,
      commitSha: bakedVersion.commitSha || 'unknown',
      buildTime: bakedVersion.buildTime || null,
      fullString: bakedVersion.fullString || packageJson.version
    };
  }

  // Runtime version detection
  const version = getVersion();
  const isTag = version.startsWith('v');
  let commitSha = 'unknown';

  // Try to get commit SHA from git
  try {
    const { execSync } = require('child_process');
    commitSha = execSync('git rev-parse --short HEAD 2>/dev/null', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore']
    }).trim();
  } catch {
    // Git not available, try env var
    if (process.env.GIT_SHA) {
      commitSha = process.env.GIT_SHA.substring(0, 7);
    }
  }

  return {
    version,
    isTag,
    commitSha,
    fullString: isTag ? `${version} (${commitSha})` : `dev-${commitSha}`
  };
}

module.exports = {
  getVersion,
  getVersionInfo
};
