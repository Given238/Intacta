'use strict';

const { Kysely, PostgresDialect } = require('kysely');
const { Pool }    = require('pg');
const env         = require('./env');

/** @type {import('pg').PoolConfig} */
const poolConfig = (() => {
  if (env.DATABASE_URL) {
    const cfg = { connectionString: env.DATABASE_URL };
    if (env.DATABASE_SSL) {
      cfg.ssl = { rejectUnauthorized: false };
    }
    return cfg;
  }
  // Fallback: individual connection parts
  return {
    host:     env.DB_HOST,
    port:     parseInt(env.DB_PORT, 10),
    database: env.DB_NAME,
    user:     env.DB_USER,
    password: env.DB_PASSWORD,
    ...(env.DATABASE_SSL ? { ssl: { rejectUnauthorized: false } } : {}),
  };
})();

const rawPool = new Pool(poolConfig);

rawPool.on('error', (err) => {
  console.error('[db] Unexpected PostgreSQL pool error:', err.message);
});

// Raw pg pool: query.js, migrate.js, seed.js and /health use pool.query / pool.connect.
// Kysely shares the same pool for typed queries.
rawPool.db = new Kysely({ dialect: new PostgresDialect({ pool: rawPool }) });

module.exports = rawPool;
