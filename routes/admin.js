const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const AWS = require('aws-sdk');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { renderPage } = require('../utils/render');

const s3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION,
});

const localDocumentsDir = path.join(__dirname, '..', 'public', 'documents');
if (!fs.existsSync(localDocumentsDir)) fs.mkdirSync(localDocumentsDir, { recursive: true });

function safeUploadName(originalName = 'upload') {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext)
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'upload';
  return `${Date.now()}-${base}${ext.toLowerCase()}`;
}

const storage = process.env.S3_BUCKET_NAME
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, localDocumentsDir),
      filename: (req, file, cb) => cb(null, safeUploadName(file.originalname)),
    });

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg']);
    const ext = path.extname(file.originalname || '').toLowerCase();
    if (!allowed.has(ext)) {
      return cb(new Error('Only PDF, Word, PNG, and JPG files are allowed.'));
    }
    cb(null, true);
  },
  limits: { fileSize: 20 * 1024 * 1024 },
});

function handleUpload(fieldName) {
  const middleware = upload.single(fieldName);
  return (req, res, next) => {
    middleware(req, res, err => {
      if (!err) return next();

      console.error('Document upload error:', err);
      const message = err instanceof multer.MulterError
        ? (err.code === 'LIMIT_FILE_SIZE'
            ? 'Upload failed: files must be 20 MB or smaller.'
            : `Upload failed: ${err.message}`)
        : (err && err.message ? `Upload failed: ${err.message}` : 'Upload failed. Please try again.');

      req.session.adminMsg = { type: 'error', text: message };
      return res.redirect('/admin');
    });
  };
}

function isOperationsAdmin(req) {
  return !!(req.session && req.session.isOperationsAdmin);
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeJsString(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

router.use(requireAdmin);

router.get('/', async (req, res) => {
  const user = {
    name: req.session.userName,
    isAdmin: true,
    isOperationsAdmin: !!req.session.isOperationsAdmin,
  };
  const msg = req.session.adminMsg || null;
  delete req.session.adminMsg;

  try {
    const [staffRes, docsRes, annRes, schedRes, payRes] = await Promise.all([
      pool.query('SELECT id, name, email, role, phone, cert_expiry, is_active, is_admin, admin_role, last_login, created_at FROM lifeguards ORDER BY created_at DESC'),
      pool.query('SELECT * FROM documents ORDER BY uploaded_at DESC'),
      pool.query('SELECT * FROM announcements ORDER BY created_at DESC'),
      pool.query('SELECT * FROM schedule_events ORDER BY event_date DESC'),
      pool.query('SELECT * FROM pay_schedule ORDER BY pay_date DESC'),
    ]);

    res.send(renderPage(
      'Admin',
      adminHTML(staffRes.rows, docsRes.rows, annRes.rows, schedRes.rows, payRes.rows, msg, user),
      user
    ));
  } catch (err) {
    console.error('Admin error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not load admin panel.' };
    res.redirect('/portal');
  }
});

router.post('/guard/add', async (req, res) => {
  const { name, email, password, role, phone, cert_expiry, hire_date } = req.body;
  const wantsAdmin = isOperationsAdmin(req) && req.body.is_admin === 'on';

  if (!name || !email || !password || password.length < 8) {
    req.session.adminMsg = { type: 'error', text: 'Name, email, and password (min 8 chars) required.' };
    return res.redirect('/admin');
  }

  try {
    const hash = bcrypt.hashSync(password, 12);
    await pool.query(
      `INSERT INTO lifeguards (name, email, password, role, is_admin, admin_role, phone, cert_expiry, hire_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        name.trim(),
        email.trim().toLowerCase(),
        hash,
        role || 'staff',
        wantsAdmin,
        wantsAdmin ? 'admin' : 'none',
        phone || null,
        cert_expiry || null,
        hire_date || null,
      ]
    );
    req.session.adminMsg = { type: 'success', text: `Account for "${name}" created.` };
  } catch (err) {
    console.error('Create account error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not create account. Email may already exist.' };
  }

  res.redirect('/admin');
});

router.post('/guard/toggle', async (req, res) => {
  const { id } = req.body;
  try {
    const result = await pool.query('SELECT is_active, is_admin, admin_role FROM lifeguards WHERE id = $1', [id]);
    const target = result.rows[0];
    if (!target) return res.redirect('/admin');

    if (target.admin_role === 'operations_admin') {
      req.session.adminMsg = { type: 'error', text: 'Operations admin access cannot be disabled here.' };
      return res.redirect('/admin');
    }
    if (target.is_admin && !isOperationsAdmin(req)) {
      req.session.adminMsg = { type: 'error', text: 'Only the operations admin can change other admin accounts.' };
      return res.redirect('/admin');
    }

    await pool.query('UPDATE lifeguards SET is_active = $1 WHERE id = $2', [!target.is_active, id]);
    req.session.adminMsg = { type: 'success', text: 'Account status updated.' };
  } catch (err) {
    console.error('Toggle account error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not update status.' };
  }

  res.redirect('/admin');
});

router.post('/guard/reset-password', async (req, res) => {
  const { id, new_password } = req.body;
  if (!new_password || new_password.length < 8) {
    req.session.adminMsg = { type: 'error', text: 'Password must be at least 8 characters.' };
    return res.redirect('/admin');
  }

  try {
    const result = await pool.query('SELECT is_admin, admin_role FROM lifeguards WHERE id = $1', [id]);
    const target = result.rows[0];
    if (!target) return res.redirect('/admin');

    if (target.admin_role === 'operations_admin') {
      req.session.adminMsg = { type: 'error', text: 'Operations admin passwords must be managed directly.' };
      return res.redirect('/admin');
    }
    if (target.is_admin && !isOperationsAdmin(req)) {
      req.session.adminMsg = { type: 'error', text: 'Only the operations admin can reset other admin passwords.' };
      return res.redirect('/admin');
    }

    await pool.query('UPDATE lifeguards SET password = $1 WHERE id = $2', [bcrypt.hashSync(new_password, 12), id]);
    req.session.adminMsg = { type: 'success', text: 'Password reset.' };
  } catch (err) {
    console.error('Reset password error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not reset password.' };
  }

  res.redirect('/admin');
});

router.post('/guard/admin-access', async (req, res) => {
  const { id, make_admin } = req.body;
  if (!isOperationsAdmin(req)) {
    req.session.adminMsg = { type: 'error', text: 'Only the operations admin can change admin access.' };
    return res.redirect('/admin');
  }

  try {
    const result = await pool.query('SELECT id, name, admin_role FROM lifeguards WHERE id = $1', [id]);
    const target = result.rows[0];
    if (!target) return res.redirect('/admin');

    if (target.admin_role === 'operations_admin') {
      req.session.adminMsg = { type: 'error', text: 'Operations admin access cannot be changed here.' };
      return res.redirect('/admin');
    }

    const grantAdmin = make_admin === 'true';
    await pool.query(
      'UPDATE lifeguards SET is_admin = $1, admin_role = $2 WHERE id = $3',
      [grantAdmin, grantAdmin ? 'admin' : 'none', id]
    );

    req.session.adminMsg = {
      type: 'success',
      text: grantAdmin
        ? `Admin panel access granted to "${target.name}".`
        : `Admin panel access removed from "${target.name}".`,
    };
  } catch (err) {
    console.error('Admin access error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not update admin access.' };
  }

  res.redirect('/admin');
});

router.post('/document/add', handleUpload('file'), async (req, res) => {
  const { title, description, category, filename } = req.body;
  if (!title || (!req.file && !filename)) {
    req.session.adminMsg = { type: 'error', text: 'Title and file are required.' };
    return res.redirect('/admin');
  }

  try {
    let filePath = filename ? filename.trim() : null;

    if (req.file) {
      if (process.env.S3_BUCKET_NAME) {
        const objectKey = safeUploadName(req.file.originalname);
        await s3.upload({
          Bucket: process.env.S3_BUCKET_NAME,
          Key: objectKey,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
        }).promise();
        filePath = objectKey;
      } else {
        filePath = req.file.filename;
      }
    }

    await pool.query(
      'INSERT INTO documents (title, description, filename, category) VALUES ($1,$2,$3,$4)',
      [title.trim(), description || '', filePath, category || 'general']
    );
    req.session.adminMsg = { type: 'success', text: `Document "${title}" added.` };
  } catch (err) {
    console.error('Could not add document:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not add document.' };
  }

  res.redirect('/admin');
});

router.post('/document/toggle', async (req, res) => {
  const { id } = req.body;
  try {
    const result = await pool.query('SELECT is_active FROM documents WHERE id = $1', [id]);
    if (!result.rows[0]) return res.redirect('/admin');

    await pool.query('UPDATE documents SET is_active = $1 WHERE id = $2', [!result.rows[0].is_active, id]);
    req.session.adminMsg = { type: 'success', text: 'Document updated.' };
  } catch (err) {
    console.error('Document toggle error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not update document.' };
  }

  res.redirect('/admin');
});

router.post('/document/delete', async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query('DELETE FROM documents WHERE id = $1', [id]);
    req.session.adminMsg = { type: 'success', text: 'Document deleted.' };
  } catch (err) {
    console.error('Document delete error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not delete document.' };
  }

  res.redirect('/admin');
});

router.post('/announcement/add', async (req, res) => {
  const { title, body, priority, author } = req.body;
  if (!title || !body) {
    req.session.adminMsg = { type: 'error', text: 'Title and body are required.' };
    return res.redirect('/admin');
  }

  try {
    await pool.query(
      'INSERT INTO announcements (title, body, priority, author) VALUES ($1,$2,$3,$4)',
      [title.trim(), body.trim(), priority || 'normal', author || req.session.userName]
    );
    req.session.adminMsg = { type: 'success', text: 'Announcement posted.' };
  } catch (err) {
    console.error('Announcement error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not post announcement.' };
  }

  res.redirect('/admin');
});

router.post('/announcement/delete', async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
    req.session.adminMsg = { type: 'success', text: 'Announcement removed.' };
  } catch (err) {
    console.error('Announcement delete error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not delete announcement.' };
  }

  res.redirect('/admin');
});

router.post('/schedule/add', async (req, res) => {
  const { title, event_date, start_time, end_time, location, description } = req.body;
  if (!title || !event_date) {
    req.session.adminMsg = { type: 'error', text: 'Title and date are required.' };
    return res.redirect('/admin');
  }

  try {
    await pool.query(
      `INSERT INTO schedule_events (title, event_date, start_time, end_time, location, description)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [title.trim(), event_date, start_time || null, end_time || null, location || null, description || null]
    );
    req.session.adminMsg = { type: 'success', text: 'Event added to schedule.' };
  } catch (err) {
    console.error('Schedule add error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not add event.' };
  }

  res.redirect('/admin');
});

router.post('/schedule/delete', async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query('DELETE FROM schedule_events WHERE id = $1', [id]);
    req.session.adminMsg = { type: 'success', text: 'Event removed.' };
  } catch (err) {
    console.error('Schedule delete error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not remove event.' };
  }

  res.redirect('/admin');
});

router.post('/pay/add', async (req, res) => {
  const { period_label, pay_date, notes } = req.body;
  if (!period_label || !pay_date) {
    req.session.adminMsg = { type: 'error', text: 'Period label and date are required.' };
    return res.redirect('/admin');
  }

  try {
    await pool.query(
      'INSERT INTO pay_schedule (period_label, pay_date, notes) VALUES ($1,$2,$3)',
      [period_label.trim(), pay_date, notes || null]
    );
    req.session.adminMsg = { type: 'success', text: 'Pay date added.' };
  } catch (err) {
    console.error('Pay add error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not add pay date.' };
  }

  res.redirect('/admin');
});

router.post('/pay/delete', async (req, res) => {
  const { id } = req.body;
  try {
    await pool.query('DELETE FROM pay_schedule WHERE id = $1', [id]);
    req.session.adminMsg = { type: 'success', text: 'Pay date removed.' };
  } catch (err) {
    console.error('Pay delete error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not remove pay date.' };
  }

  res.redirect('/admin');
});

module.exports = router;

function adminHTML(staff, docs, announcements, schedule, payDates, msg, viewer) {
  const msgBlock = msg ? `<div class="alert alert-${msg.type}">${msg.text}</div>` : '';
  const staffIntro = viewer.isOperationsAdmin
    ? `<div class="info-card"><strong>Operations Admin:</strong> You can manage all staff accounts and grant or remove admin panel access.</div>`
    : `<div class="info-card"><strong>Admin Access:</strong> You can manage staff content and non-admin accounts. Operations admin access stays restricted to Brant.</div>`;

  const staffRows = staff.map(person => {
    const safeName = escapeHtml(person.name);
    const safeEmail = escapeHtml(person.email);
    const safeRole = escapeHtml(person.role || 'staff');
    const resetName = escapeJsString(person.name);
    const statusBadge = person.is_active ? 'badge-active' : 'badge-inactive';
    const statusLabel = person.is_active ? 'Active' : 'Off';
    const accessBadge = person.admin_role === 'operations_admin'
      ? '<span class="badge badge-admin">Operations Admin</span>'
      : person.is_admin
        ? '<span class="badge badge-admin">Admin</span>'
        : '<span class="badge">Staff</span>';

    const canManageThisUser = person.admin_role !== 'operations_admin' && (!person.is_admin || viewer.isOperationsAdmin);
    const actions = [];

    if (canManageThisUser) {
      actions.push(`
        <form method="POST" action="/admin/guard/toggle" style="display:inline">
          <input type="hidden" name="id" value="${person.id}">
          <button type="submit" class="btn-tbl">${person.is_active ? 'Disable' : 'Enable'}</button>
        </form>
      `);
      actions.push(`
        <button type="button" class="btn-tbl" onclick="showReset(${person.id}, '${resetName}')">Reset PW</button>
      `);
    }

    if (viewer.isOperationsAdmin && person.admin_role !== 'operations_admin') {
      actions.push(`
        <form method="POST" action="/admin/guard/admin-access" style="display:inline">
          <input type="hidden" name="id" value="${person.id}">
          <input type="hidden" name="make_admin" value="${person.is_admin ? 'false' : 'true'}">
          <button type="submit" class="btn-tbl">${person.is_admin ? 'Remove Admin' : 'Make Admin'}</button>
        </form>
      `);
    }

    return `
      <tr>
        <td><strong>${safeName}</strong></td>
        <td class="td-email">${safeEmail}</td>
        <td>${safeRole}</td>
        <td>${accessBadge}</td>
        <td><span class="badge ${statusBadge}">${statusLabel}</span></td>
        <td>${person.last_login ? new Date(person.last_login).toLocaleDateString() : 'Never'}</td>
        <td class="actions">${actions.join('') || '<span class="hint">Protected</span>'}</td>
      </tr>`;
  }).join('');

  const docRows = docs.map(doc => `
    <tr>
      <td><strong>${escapeHtml(doc.title)}</strong></td>
      <td><code>${escapeHtml(doc.filename)}</code></td>
      <td>${escapeHtml(doc.category)}</td>
      <td><span class="badge ${doc.is_active ? 'badge-active' : 'badge-inactive'}">${doc.is_active ? 'Visible' : 'Hidden'}</span></td>
      <td class="actions">
        <form method="POST" action="/admin/document/toggle" style="display:inline">
          <input type="hidden" name="id" value="${doc.id}">
          <button type="submit" class="btn-tbl">${doc.is_active ? 'Hide' : 'Show'}</button>
        </form>
        <form method="POST" action="/admin/document/delete" style="display:inline" onsubmit="return confirm('Delete this document?')">
          <input type="hidden" name="id" value="${doc.id}">
          <button type="submit" class="btn-tbl btn-danger">Delete</button>
        </form>
      </td>
    </tr>`).join('');

  const annRows = announcements.map(item => `
    <tr>
      <td><strong>${escapeHtml(item.title)}</strong></td>
      <td>${escapeHtml(item.body.slice(0, 60))}${item.body.length > 60 ? '...' : ''}</td>
      <td><span class="badge priority-badge-${item.priority}">${escapeHtml(item.priority)}</span></td>
      <td>${new Date(item.created_at).toLocaleDateString()}</td>
      <td>
        <form method="POST" action="/admin/announcement/delete" style="display:inline" onsubmit="return confirm('Remove this announcement?')">
          <input type="hidden" name="id" value="${item.id}">
          <button type="submit" class="btn-tbl btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  const schedRows = schedule.map(event => `
    <tr>
      <td><strong>${escapeHtml(event.title)}</strong></td>
      <td>${new Date(event.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</td>
      <td>${event.start_time || '-'}</td>
      <td>${event.location ? escapeHtml(event.location) : '-'}</td>
      <td>
        <form method="POST" action="/admin/schedule/delete" style="display:inline" onsubmit="return confirm('Remove this event?')">
          <input type="hidden" name="id" value="${event.id}">
          <button type="submit" class="btn-tbl btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  const payRows = payDates.map(pay => `
    <tr>
      <td><strong>${escapeHtml(pay.period_label)}</strong></td>
      <td>${new Date(pay.pay_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</td>
      <td>${pay.notes ? escapeHtml(pay.notes) : '-'}</td>
      <td>
        <form method="POST" action="/admin/pay/delete" style="display:inline" onsubmit="return confirm('Remove this pay date?')">
          <input type="hidden" name="id" value="${pay.id}">
          <button type="submit" class="btn-tbl btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  return `
  <div class="portal-wrap">
    <div class="page-header">
      <h1>Admin Panel</h1>
      <a href="/portal" class="btn-secondary">Back to Portal</a>
    </div>
    ${msgBlock}

    <div class="admin-tabs">
      <button type="button" class="tab-btn active" data-tab="guards">Staff</button>
      <button type="button" class="tab-btn" data-tab="announcements">Announcements</button>
      <button type="button" class="tab-btn" data-tab="schedule">Schedule</button>
      <button type="button" class="tab-btn" data-tab="pay">Pay</button>
      <button type="button" class="tab-btn" data-tab="documents">Documents</button>
    </div>

    <div id="tab-guards" class="tab-content active">
      ${staffIntro}
      <div class="admin-section">
        <h2>Add Staff Account</h2>
        <form method="POST" action="/admin/guard/add" class="portal-form grid-form">
          <div class="field"><label>Full Name</label><input type="text" name="name" required placeholder="Jane Smith"></div>
          <div class="field"><label>Email</label><input type="email" name="email" required placeholder="jane@example.com"></div>
          <div class="field"><label>Password <span class="hint">(min 8 chars)</span></label><input type="password" name="password" required minlength="8"></div>
          <div class="field"><label>Role</label>
            <select name="role">
              <option value="staff">Staff</option>
              <option value="operations">Operations</option>
              <option value="management">Management</option>
              <option value="maintenance">Maintenance</option>
              <option value="security">Security</option>
              <option value="administration">Administration</option>
            </select>
          </div>
          <div class="field"><label>Phone <span class="hint">(optional)</span></label><input type="tel" name="phone" placeholder="(555) 000-0000"></div>
          <div class="field"><label>Cert Expiry <span class="hint">(optional)</span></label><input type="date" name="cert_expiry"></div>
          ${viewer.isOperationsAdmin ? '<div class="field"><label><input type="checkbox" name="is_admin"> Admin Panel Access</label><span class="hint">Lets this staff member access /admin.</span></div>' : ''}
          <div class="field form-full"><button type="submit" class="btn-primary">Create Account</button></div>
        </form>
      </div>
      <div class="admin-section">
        <h2>All Staff</h2>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Access</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>${staffRows || '<tr><td colspan="7">No staff accounts yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="tab-announcements" class="tab-content">
      <div class="admin-section">
        <h2>Post Announcement</h2>
        <form method="POST" action="/admin/announcement/add" class="portal-form grid-form">
          <div class="field"><label>Title</label><input type="text" name="title" required placeholder="Announcement title"></div>
          <div class="field"><label>Priority</label>
            <select name="priority">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div class="field form-full"><label>Body</label><textarea name="body" required rows="4" placeholder="Write your announcement here..."></textarea></div>
          <div class="field"><label>Author <span class="hint">(optional)</span></label><input type="text" name="author" placeholder="Your name"></div>
          <div class="field form-full"><button type="submit" class="btn-primary">Post Announcement</button></div>
        </form>
      </div>
      <div class="admin-section">
        <h2>Posted Announcements</h2>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Title</th><th>Preview</th><th>Priority</th><th>Date</th><th>Action</th></tr></thead>
            <tbody>${annRows || '<tr><td colspan="5">No announcements yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="tab-schedule" class="tab-content">
      <div class="admin-section">
        <h2>Add Event / Shift</h2>
        <form method="POST" action="/admin/schedule/add" class="portal-form grid-form">
          <div class="field"><label>Event Title</label><input type="text" name="title" required placeholder="e.g. Team Meeting, Property Walk"></div>
          <div class="field"><label>Date</label><input type="date" name="event_date" required></div>
          <div class="field"><label>Start Time <span class="hint">(optional)</span></label><input type="time" name="start_time"></div>
          <div class="field"><label>End Time <span class="hint">(optional)</span></label><input type="time" name="end_time"></div>
          <div class="field"><label>Location <span class="hint">(optional)</span></label><input type="text" name="location" placeholder="e.g. Clubhouse, Front Gate"></div>
          <div class="field form-full"><label>Description <span class="hint">(optional)</span></label><textarea name="description" rows="2" placeholder="Additional details..."></textarea></div>
          <div class="field form-full"><button type="submit" class="btn-primary">Add to Schedule</button></div>
        </form>
      </div>
      <div class="admin-section">
        <h2>All Events</h2>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Title</th><th>Date</th><th>Start</th><th>Location</th><th>Action</th></tr></thead>
            <tbody>${schedRows || '<tr><td colspan="5">No events added yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="tab-pay" class="tab-content">
      <div class="admin-section">
        <h2>Add Pay Date</h2>
        <form method="POST" action="/admin/pay/add" class="portal-form grid-form">
          <div class="field"><label>Period Label</label><input type="text" name="period_label" required placeholder="e.g. May 1-15 2026"></div>
          <div class="field"><label>Pay Date</label><input type="date" name="pay_date" required></div>
          <div class="field form-full"><label>Notes <span class="hint">(optional)</span></label><input type="text" name="notes" placeholder="e.g. Direct deposit. Allow 1-2 business days."></div>
          <div class="field form-full"><button type="submit" class="btn-primary">Add Pay Date</button></div>
        </form>
      </div>
      <div class="admin-section">
        <h2>Pay Schedule</h2>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Period</th><th>Pay Date</th><th>Notes</th><th>Action</th></tr></thead>
            <tbody>${payRows || '<tr><td colspan="4">No pay dates added yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <div id="tab-documents" class="tab-content">
      <div class="admin-section">
        <h2>Upload Document</h2>
        <form method="POST" action="/admin/document/add" class="portal-form grid-form" enctype="multipart/form-data">
          <div class="field"><label>Title</label><input type="text" name="title" required placeholder="e.g. Staff Handbook 2026"></div>
          <div class="field"><label>Category</label>
            <select name="category">
              <option value="general">General</option>
              <option value="policy">Policies and Procedures</option>
              <option value="training">Training and Certification</option>
              <option value="forms">Forms and Applications</option>
              <option value="emergency">Emergency Protocols</option>
            </select>
          </div>
          <div class="field form-full"><label>Description <span class="hint">(optional)</span></label><input type="text" name="description" placeholder="Brief description for staff"></div>
          <div class="field form-full">
            <label>Upload File <span class="hint">(uploads to S3 when configured)</span></label>
            <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg">
            <p class="hint" style="margin-top:4px">Or enter a filename already in /public/documents/:</p>
            <input type="text" name="filename" placeholder="e.g. handbook-2026.pdf">
          </div>
          <div class="field form-full"><button type="submit" class="btn-primary">Add Document</button></div>
        </form>
      </div>
      <div class="admin-section">
        <h2>All Documents</h2>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Title</th><th>File</th><th>Category</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>${docRows || '<tr><td colspan="5">No documents yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <div id="reset-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:999; align-items:center; justify-content:center; padding:20px;">
    <div class="card" style="max-width:380px; width:100%;">
      <h3 id="reset-title" style="margin-bottom:16px;">Reset Password</h3>
      <form method="POST" action="/admin/guard/reset-password" class="portal-form">
        <input type="hidden" name="id" id="reset-id">
        <div class="field">
          <label>New Password <span class="hint">(min 8 chars)</span></label>
          <input type="password" name="new_password" required minlength="8">
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <button type="submit" class="btn-primary">Reset</button>
          <button type="button" class="btn-secondary" onclick="document.getElementById('reset-modal').style.display='none'">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <script src="/public/js/admin.js"></script>`;
}
