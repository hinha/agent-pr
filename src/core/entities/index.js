/**
 * Export all domain entities
 */

const PullRequest = require('./PullRequest');
const Review = require('./Review');
const Repository = require('./Repository');
const FileChange = require('./FileChange');
const ReviewComment = require('./ReviewComment');

module.exports = {
  PullRequest,
  Review,
  Repository,
  FileChange,
  ReviewComment
};
