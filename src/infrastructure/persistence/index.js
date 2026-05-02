/**
 * Export persistence infrastructure components
 */

const FileSystemStateRepository = require('./FileSystemStateRepository');
const InMemoryStateRepository = require('./InMemoryStateRepository');

module.exports = {
  FileSystemStateRepository,
  InMemoryStateRepository
};
