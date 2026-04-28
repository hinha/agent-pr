/**
 * Export the DI container and bindings
 */

const container = require('./Container');
const BINDINGS = require('./bindings');

module.exports = container;
module.exports.BINDINGS = BINDINGS;
module.exports.default = container;
