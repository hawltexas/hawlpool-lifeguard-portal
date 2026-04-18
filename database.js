const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initialize() {
  // Users table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS lifeguards (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'staff',
      is_admin BOOLEAN DEFAULT false,
      admin_role TEXT DEFAULT 'none',
      is_active BOOLEAN DEFAULT true,
      phone TEXT,
      cert_expiry DATE,
      hire_date DATE,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_login TIMESTAMP
    );
  `);

  await pool.query(`ALTER TABLE lifeguards ADD COLUMN IF NOT EXISTS admin_role TEXT DEFAULT 'none';`);
  await pool.query(`ALTER TABLE lifeguards ALTER COLUMN role SET DEFAULT 'staff';`);
  await pool.query(`
    UPDATE lifeguards
    SET admin_role = CASE
      WHEN is_admin = true AND (admin_role IS NULL OR admin_role = '' OR admin_role = 'none') THEN 'admin'
      WHEN is_admin = false THEN 'none'
      ELSE admin_role
    END
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

  // Seed operations admin if not present
  const adminEmail = (process.env.ADMIN_EMAIL || 'brant@brantborden.com').toLowerCase();
  const admin = await pool.query(
    'SELECT id FROM lifeguards WHERE email = $1',
    [adminEmail]
  );
  if (admin.rows.length === 0) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'ihatebash001', 12);
    await pool.query(
      `INSERT INTO lifeguards (name, email, password, is_admin, admin_role, role)
       VALUES ($1, $2, $3, true, 'operations_admin', 'operations')`,
      ['Brant Borden', adminEmail, hash]
    );
    console.log('Admin account seeded.');
  }

  await pool.query(
    `UPDATE lifeguards
     SET is_admin = true,
         admin_role = 'operations_admin',
         role = CASE WHEN role IS NULL OR role = '' OR role = 'staff' THEN 'operations' ELSE role END
     WHERE email = $1`,
    [adminEmail]
  );

  console.log('Database ready.');
}

module.exports = { pool, initialize };
