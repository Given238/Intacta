const pool = require('../config/db');

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development') {
    console.log('SQL:', text, '| params:', params, '| duration:', duration + 'ms');
  }
  return result;
}

module.exports = { query };
