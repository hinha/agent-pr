#!/usr/bin/env node
/**
 * State Migration Script
 * Migrates from flat state files to repository-scoped state structure
 *
 * Usage: node scripts/migrateState.js <owner> <repo>
 * Example: node scripts/migrateState.js PT-Sinarmas-Multifinance simasfin-backend
 */

const fs = require('fs/promises');
const path = require('path');
const yaml = require('js-yaml');

const DATA_DIR = path.join(process.cwd(), 'data');

async function migrateState(owner, repo) {
  console.log(`🔄 Migrating state for ${owner}/${repo}...`);

  const instanceKey = `github/${owner}`;
  const repoDir = path.join(DATA_DIR, 'instances', instanceKey.replace('github/', 'github-'), repo);

  await fs.mkdir(repoDir, { recursive: true });
  console.log(`📁 Created repository directory: ${repoDir}`);

  const migrations = [
    {
      source: path.join(DATA_DIR, 'processed_prs.json'),
      target: path.join(repoDir, 'processed_prs.json'),
      name: 'processed PRs'
    },
    {
      source: path.join(DATA_DIR, 'notification_counts.json'),
      target: path.join(repoDir, 'notification_counts.json'),
      name: 'notification counts'
    },
    {
      source: path.join(DATA_DIR, 'skip_cache.json'),
      target: path.join(repoDir, 'skip_cache.json'),
      name: 'skip cache'
    },
    {
      source: path.join(DATA_DIR, 'processed_timestamps.json'),
      target: path.join(repoDir, 'processed_timestamps.json'),
      name: 'processed timestamps'
    }
  ];

  for (const migration of migrations) {
    try {
      const raw = await fs.readFile(migration.source, 'utf8');
      const data = JSON.parse(raw);

      if (Array.isArray(data) && data.length === 0) {
        console.log(`⏭️  Skipping ${migration.name}: empty array`);
        continue;
      }

      if (typeof data === 'object' && Object.keys(data).length === 0) {
        console.log(`⏭️  Skipping ${migration.name}: empty object`);
        continue;
      }

      await fs.writeFile(migration.target, JSON.stringify(data, null, 2));
      console.log(`✅ Migrated ${migration.name}: ${Object.keys(data).length} entries`);
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`⚠️  ${migration.name} not found, skipping`);
      } else {
        console.error(`❌ Failed to migrate ${migration.name}: ${err.message}`);
      }
    }
  }

  console.log(`\n✨ Migration complete for ${owner}/${repo}`);
  console.log(`📂 State files stored in: ${repoDir}`);
  console.log(`\n⚠️  IMPORTANT: After migration, you can backup and remove old state files from data/`);
}

async function showUsage() {
  console.log(`
📦 Multi-Instance PR Monitor - State Migration Tool

Migrates flat state files to repository-scoped structure.

Usage:
  node scripts/migrateState.js <owner> <repo>

Example:
  node scripts/migrateState.js PT-Sinarmas-Multifinance simasfin-backend

This will:
  1. Create data/instances/github-PT-Sinarmas-Multifinance/simasfin-backend/
  2. Copy existing state files to the repository directory
  3. Leave original files untouched (you can backup and remove them after)

Available repositories from config.yml:
`);

  try {
    const configPath = path.join(process.cwd(), 'config.yml');
    const raw = await fs.readFile(configPath, 'utf8');
    const config = yaml.load(raw);

    for (const key of Object.keys(config)) {
      if (key.startsWith('github/')) {
        const [_, owner] = key.split('/');
        console.log(`  Instance: ${key}`);
        if (config[key].repos) {
          for (const repo of Object.keys(config[key].repos)) {
            console.log(`    - ${owner} ${repo}`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`  (Cannot read config.yml: ${err.message})`);
  }

  console.log(``);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help') || args.includes('-h')) {
    await showUsage();
    process.exit(args.length < 2 ? 1 : 0);
  }

  const [owner, repo] = args;

  await migrateState(owner, repo);
}

main().catch(err => {
  console.error(`❌ Migration failed: ${err.message}`);
  process.exit(1);
});
