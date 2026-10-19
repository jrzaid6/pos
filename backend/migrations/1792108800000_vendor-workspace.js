const fs = require('fs');
const path = require('path');

exports.up = (pgm) => pgm.sql(fs.readFileSync(path.join(__dirname, '../database/vendor-workspace.sql'), 'utf8'));
exports.down = () => { throw new Error('Vendor financial history must be restored from a verified backup, not dropped.'); };
