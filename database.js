const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initialize() {
  // Users table (lifeguards)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lifeguards (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'lifeguard',
      is_admin BOOLEAN DEFAULT false,
      is_active BOOLEAN DEFAULT true,
      phone TEXT,
      cert_expiry DATE,
      hire_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    );
  `);

  // Documents table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      filename TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      is_active BOOLEAN DEFAULT true,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Announcements table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS announcements (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      priority TEXT DEFAULT 'normal',
      is_active BOOLEAN DEFAULT true,
      author TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Pay schedule table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pay_schedule (
      id SERIAL PRIMARY KEY,
      period_label TEXT NOT NULL,
      pay_date DATE NOT NULL,
      notes TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Shift schedule / events table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schedule_events (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      event_date DATE NOT NULL,
      start_time TEXT,
      end_time TEXT,
      location TEXT,
      description TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed admin if not present
  const admin = await pool.query(
    'SELECT id FROM lifeguards WHERE email = $1',
    ['brant@brantborden.com']
  );
  if (admin.rows.length === 0) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ihatebash001', 12);
    await pool.query(
      `INSERT INTO lifeguards (name, email, password, is_admin, role)
       VALUES ($1, $2, $3, true, 'admin')`,
      ['Brant Borden', 'brant@brantborden.com', hash]
    );
    console.log('Admin account seeded.');
  }

  console.log('Database ready.');
}

module.exports = { pool, initialize };
