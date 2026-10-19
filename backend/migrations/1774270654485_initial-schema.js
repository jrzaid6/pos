const fs = require('fs');
const path = require('path');

exports.shorthands = undefined;

exports.up = (pgm) => {
  const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
  pgm.sql(fs.readFileSync(schemaPath, 'utf8'));
};

exports.down = () => {
  throw new Error('The POS baseline contains shop and financial records and cannot be rolled back automatically. Restore a verified database backup instead.');
};
