#!/usr/bin/env node

/**
 * Pre-build script - generates version file for baking into binary
 *
 * This script is called before pkg build to create a .version.json file
 * that contains version info baked into the compiled binary.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const packageJson = require('../package.json');

// Get version info
const version = process.env.GIT_TAG || process.env.BUILD_VERSION || packageJson.version;
const isTag = version.startsWith('v');

let commitSha = 'unknown';
try {
  commitSha = execSync('git rev-parse --short HEAD', {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'ignore']
  }).trim();
} catch {
  // Git not available, use env var or placeholder
  commitSha = process.env.GIT_SHA ? process.env.GIT_SHA.substring(0, 7) : 'unknown';
}

const buildTime = new Date().toISOString();
const fullString = isTag ? `${version} (${commitSha})` : `dev-${commitSha}`;

// Generate version data
const versionData = {
  version,
  isTag,
  commitSha,
  buildTime,
  fullString
};

// Write version file
const versionFilePath = path.join(__dirname, '../.version.json');
fs.writeFileSync(versionFilePath, JSON.stringify(versionData, null, 2), 'utf8');

console.log(`✅ Version file generated: ${versionFilePath}`);
console.log(`   Version: ${fullString}`);
console.log(`   Build Time: ${buildTime}`);
