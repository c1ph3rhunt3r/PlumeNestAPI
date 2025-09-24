const NodeCache = require('node-cache');

// TTL in seconds. 14400s = 4 hours for streams. 86400s = 24 hours for metadata.
const streamCache = new NodeCache({ stdTTL: 14400 });
const metadataCache = new NodeCache({ stdTTL: 86400 });

module.exports = { streamCache, metadataCache };