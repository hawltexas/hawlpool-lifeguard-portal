const express  = require('express');
const bcrypt   = require('bcryptjs');
const router   = express.Router();
const AWS      = require('aws-sdk');
const multer   = require('multer');
const multerS3 = require('multer-s3');
const { pool } = require('../database');
const { requireAdmin } = require('../middleware/auth');
const { renderPage }   = require('../utils/render');

// S3 setup
const s3 = new AWS.S3({
  accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region:          process.env.AWS_REGION,
});

const upload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET_NAME,
    acl: 'private',
    key: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
  }),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

router.use(requireAdmin);

// ── GET /admin ─────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const user = { name: req.session.userName, isAdmin: true };
  const msg  = req.session.adminMsg || null;
  delete req.session.adminMsg;
  try {
    const [guardsRes, docsRes, annRes, schedRes, payRes] = await Promise.all([
      pool.query('SELECT id, name, email, role, phone, cert_expiry, is_active, is_admin, last_login, created_at FROM lifeguards ORDER BY created_at DESC'),
      pool.query('SELECT * FROM documents ORDER BY uploaded_at DESC'),
      pool.query('SELECT * FROM announcements ORDER BY created_at DESC'),
      pool.query('SELECT * FROM schedule_events ORDER BY event_date DESC'),
      pool.query('SELECT * FROM pay_schedule ORDER BY pay_date DESC'),
    ]);
    res.send(renderPage('Admin', adminHTML(guardsRes.rows, docsRes.rows, annRes.rows, schedRes.rows, payRes.rows, msg), user));
  } catch (err) {
    console.error('Admin error:', err);
    req.session.adminMsg = { type: 'error', text: 'Could not load admin panel.' };
    res.redirect('/portal');
  }
});

// ── Lifeguard CRUD ─────────────────────────────────────────────────────
router.post('/guard/add', async (req, res) => {
  const { name, email, password, role, phone, cert_expiry, hire_date } = req.body;
  if (!name || !email || !password || password.length < 8) {
    req.session.adminMsg = { type: 'error', text: 'Name, email, and password (min 8 chars) required.' };
    return res.redirect('/admin');
  }
  try {
    const hash = bcrypt.hashSync(password, 12);
    await pool.query(
      `INSERT INTO lifeguards (name, email, password, role, phone, cert_expiry, hire_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [name.trim(), email.trim().toLowerCase(), hash, role || 'lifeguard', phone || null, cert_expiry || null, hire_date || null]
    );
    req.session.adminMsg = { type: 'success', text: `Account for "${name}" created.` };
  } catch (err) {
    console.error(err);
    req.session.adminMsg = { type: 'error', text: 'Could not create account. Email may already exist.' };
  }
  res.redirect('/admin');
});

router.post('/guard/toggle', async (req, res) => {
  const { id } = req.body;
  try {
    const r = await pool.query('SELECT is_active FROM lifeguards WHERE id = $1', [id]);
    if (!r.rows[0]) return res.redirect('/admin');
    await pool.query('UPDATE lifeguards SET is_active = $1 WHERE id = $2', [!r.rows[0].is_active, id]);
    req.session.adminMsg = { type: 'success', text: 'Account status updated.' };
  } catch (err) {
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
    await pool.query('UPDATE lifeguards SET password = $1 WHERE id = $2', [bcrypt.hashSync(new_password, 12), id]);
    req.session.adminMsg = { type: 'success', text: 'Password reset.' };
  } catch (err) {
    req.session.adminMsg = { type: 'error', text: 'Could not reset password.' };
  }
  res.redirect('/admin');
});

// ── Documents CRUD ─────────────────────────────────────────────────────
router.post('/document/add', upload.single('file'), async (req, res) => {
  const { title, description, category, filename } = req.body;
  if (!title || (!req.file && !filename)) {
    req.session.adminMsg = { type: 'error', text: 'Title and file are required.' };
    return res.redirect('/admin');
  }
  const filePath = req.file ? req.file.key : filename.trim();
  try {
    await pool.query(
      `INSERT INTO documents (title, description, filename, category) VALUES ($1,$2,$3,$4)`,
      [title.trim(), description || '', filePath, category || 'general']
    );
    req.session.adminMsg = { type: 'success', text: `Document "${title}" added.` };
  } catch (err) {
    req.session.adminMsg = { type: 'error', text: 'Could not add document.' };
  }
  res.redirect('/admin');
});

router.post('/document/toggle', async (req, res) => {
  const { id } = req.body;
  try {
    const r = await pool.query('SELECT is_active FROM documents WHERE id = $1', [id]);
    if (!r.rows[0]) return res.redirect('/admin');
    await pool.query('UPDATE documents SET is_active = $1 WHERE id = $2', [!r.rows[0].is_active, id]);
    req.session.adminMsg = { type: 'success', text: 'Document updated.' };
  } catch (err) {
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
    req.session.adminMsg = { type: 'error', text: 'Could not delete document.' };
  }
  res.redirect('/admin');
});

// ── Announcements CRUD ─────────────────────────────────────────────────
router.post('/announcement/add', async (req, res) => {
  const { title, body, priority, author } = req.body;
  if (!title || !body) {
    req.session.adminMsg = { type: 'error', text: 'Title and body are required.' };
    return res.redirect('/admin');
  }
  try {
    await pool.query(
      `INSERT INTO announcements (title, body, priority, author) VALUES ($1,$2,$3,$4)`,
      [title.trim(), body.trim(), priority || 'normal', author || req.session.userName]
    );
    req.session.adminMsg = { type: 'success', text: 'Announcement posted.' };
  } catch (err) {
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
    req.session.adminMsg = { type: 'error', text: 'Could not delete announcement.' };
  }
  res.redirect('/admin');
});

// ── Schedule CRUD ──────────────────────────────────────────────────────
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
    req.session.adminMsg = { type: 'error', text: 'Could not remove event.' };
  }
  res.redirect('/admin');
});

// ── Pay Schedule CRUD ──────────────────────────────────────────────────
router.post('/pay/add', async (req, res) => {
  const { period_label, pay_date, notes } = req.body;
  if (!period_label || !pay_date) {
    req.session.adminMsg = { type: 'error', text: 'Period label and date are required.' };
    return res.redirect('/admin');
  }
  try {
    await pool.query(
      `INSERT INTO pay_schedule (period_label, pay_date, notes) VALUES ($1,$2,$3)`,
      [period_label.trim(), pay_date, notes || null]
    );
    req.session.adminMsg = { type: 'success', text: 'Pay date added.' };
  } catch (err) {
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
    req.session.adminMsg = { type: 'error', text: 'Could not remove pay date.' };
  }
  res.redirect('/admin');
});

module.exports = router;

// ─────────────── ADMIN HTML ───────────────────────────────────────────
function adminHTML(guards, docs, announcements, schedule, payDates, msg) {
  const msgBlock = msg ? `<div class="alert alert-${msg.type}">${msg.text}</div>` : '';

  const guardRows = guards.map(g => `
    <tr>
      <td><strong>${g.name}</strong>${g.is_admin ? ' <span class="badge badge-admin">Admin</span>' : ''}</td>
      <td class="td-email">${g.email}</td>
      <td>${g.role || 'lifeguard'}</td>
      <td><span class="badge ${g.is_active ? 'badge-active' : 'badge-inactive'}">${g.is_active ? 'Active' : 'Off'}</span></td>
      <td>${g.last_login ? new Date(g.last_login).toLocaleDateString() : 'Never'}</td>
      <td class="actions">
        ${g.is_admin ? '' : `
          <form method="POST" action="/admin/guard/toggle" style="display:inline">
            <input type="hidden" name="id" value="${g.id}">
            <button type="submit" class="btn-tbl">${g.is_active ? 'Disable' : 'Enable'}</button>
          </form>
          <button class="btn-tbl" onclick="showReset(${g.id},'${g.name}')">Reset PW</button>`}
      </td>
    </tr>`).join('');

  const docRows = docs.map(d => `
    <tr>
      <td><strong>${d.title}</strong></td>
      <td><code>${d.filename}</code></td>
      <td>${d.category}</td>
      <td><span class="badge ${d.is_active ? 'badge-active' : 'badge-inactive'}">${d.is_active ? 'Visible' : 'Hidden'}</span></td>
      <td class="actions">
        <form method="POST" action="/admin/document/toggle" style="display:inline">
          <input type="hidden" name="id" value="${d.id}">
          <button type="submit" class="btn-tbl">${d.is_active ? 'Hide' : 'Show'}</button>
        </form>
        <form method="POST" action="/admin/document/delete" style="display:inline" onsubmit="return confirm('Delete this document?')">
          <input type="hidden" name="id" value="${d.id}">
          <button type="submit" class="btn-tbl btn-danger">Delete</button>
        </form>
      </td>
    </tr>`).join('');

  const annRows = announcements.map(a => `
    <tr>
      <td><strong>${a.title}</strong></td>
      <td>${a.body.slice(0,60)}${a.body.length > 60 ? '…' : ''}</td>
      <td><span class="badge priority-badge-${a.priority}">${a.priority}</span></td>
      <td>${new Date(a.created_at).toLocaleDateString()}</td>
      <td>
        <form method="POST" action="/admin/announcement/delete" style="display:inline" onsubmit="return confirm('Remove this announcement?')">
          <input type="hidden" name="id" value="${a.id}">
          <button type="submit" class="btn-tbl btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  const schedRows = schedule.map(e => `
    <tr>
      <td><strong>${e.title}</strong></td>
      <td>${new Date(e.event_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}</td>
      <td>${e.start_time || '—'}</td>
      <td>${e.location || '—'}</td>
      <td>
        <form method="POST" action="/admin/schedule/delete" style="display:inline" onsubmit="return confirm('Remove this event?')">
          <input type="hidden" name="id" value="${e.id}">
          <button type="submit" class="btn-tbl btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  const payRows = payDates.map(p => `
    <tr>
      <td><strong>${p.period_label}</strong></td>
      <td>${new Date(p.pay_date).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}</td>
      <td>${p.notes || '—'}</td>
      <td>
        <form method="POST" action="/admin/pay/delete" style="display:inline" onsubmit="return confirm('Remove this pay date?')">
          <input type="hidden" name="id" value="${p.id}">
          <button type="submit" class="btn-tbl btn-danger">Remove</button>
        </form>
      </td>
    </tr>`).join('');

  return `
  <div class="portal-wrap">
    <div class="page-header">
      <h1>⚙️ Admin Panel</h1>
      <a href="/portal" class="btn-secondary">Back to Portal</a>
    </div>
    ${msgBlock}

    <!-- TABS -->
    <div class="admin-tabs">
      <button class="tab-btn active" onclick="showTab(event, 'guards')">Staff</button>
      <button class="tab-btn" onclick="showTab(event, 'announcements')">Announcements</button>
      <button class="tab-btn" onclick="showTab(event, 'schedule')">Schedule</button>
      <button class="tab-btn" onclick="showTab(event, 'pay')">Pay</button>
      <button class="tab-btn" onclick="showTab(event, 'documents')">Documents</button>
    </div>

    <!-- STAFF TAB -->
    <div id="tab-guards" class="tab-content active">
      <div class="admin-section">
        <h2>Add Staff Account</h2>
        <form method="POST" action="/admin/guard/add" class="portal-form grid-form">
          <div class="field"><label>Full Name</label><input type="text" name="name" required placeholder="Jane Smith"></div>
          <div class="field"><label>Email</label><input type="email" name="email" required placeholder="jane@example.com"></div>
          <div class="field"><label>Password <span class="hint">(min 8 chars)</span></label><input type="password" name="password" required minlength="8"></div>
          <div class="field"><label>Role</label>
            <select name="role">
              <option value="lifeguard">Lifeguard</option>
              <option value="senior">Senior Lifeguard</option>
              <option value="supervisor">Supervisor</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div class="field"><label>Phone <span class="hint">(optional)</span></label><input type="tel" name="phone" placeholder="(555) 000-0000"></div>
          <div class="field"><label>Cert Expiry <span class="hint">(optional)</span></label><input type="date" name="cert_expiry"></div>
          <div class="field form-full"><button type="submit" class="btn-primary">Create Account</button></div>
        </form>
      </div>
      <div class="admin-section">
        <h2>All Staff</h2>
        <div class="table-wrap">
          <table class="admin-table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Last Login</th><th>Actions</th></tr></thead>
            <tbody>${guardRows || '<tr><td colspan="6">No staff accounts yet.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- ANNOUNCEMENTS TAB -->
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

    <!-- SCHEDULE TAB -->
    <div id="tab-schedule" class="tab-content">
      <div class="admin-section">
        <h2>Add Event / Shift</h2>
        <form method="POST" action="/admin/schedule/add" class="portal-form grid-form">
          <div class="field"><label>Event Title</label><input type="text" name="title" required placeholder="e.g. Morning Shift, CPR Training"></div>
          <div class="field"><label>Date</label><input type="date" name="event_date" required></div>
          <div class="field"><label>Start Time <span class="hint">(optional)</span></label><input type="time" name="start_time"></div>
          <div class="field"><label>End Time <span class="hint">(optional)</span></label><input type="time" name="end_time"></div>
          <div class="field"><label>Location <span class="hint">(optional)</span></label><input type="text" name="location" placeholder="e.g. Main Pool Deck"></div>
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

    <!-- PAY TAB -->
    <div id="tab-pay" class="tab-content">
      <div class="admin-section">
        <h2>Add Pay Date</h2>
        <form method="POST" action="/admin/pay/add" class="portal-form grid-form">
          <div class="field"><label>Period Label</label><input type="text" name="period_label" required placeholder="e.g. May 1–15 2026"></div>
          <div class="field"><label>Pay Date</label><input type="date" name="pay_date" required></div>
          <div class="field form-full"><label>Notes <span class="hint">(optional)</span></label><input type="text" name="notes" placeholder="e.g. Direct deposit. Allow 1–2 business days."></div>
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

    <!-- DOCUMENTS TAB -->
    <div id="tab-documents" class="tab-content">
      <div class="admin-section">
        <h2>Upload Document</h2>
        <form method="POST" action="/admin/document/add" class="portal-form grid-form" enctype="multipart/form-data">
          <div class="field"><label>Title</label><input type="text" name="title" required placeholder="e.g. Employee Handbook 2026"></div>
          <div class="field"><label>Category</label>
            <select name="category">
              <option value="general">General</option>
              <option value="policy">Policies & Procedures</option>
              <option value="training">Training & Certification</option>
              <option value="forms">Forms & Applications</option>
              <option value="emergency">Emergency Protocols</option>
            </select>
          </div>
          <div class="field form-full"><label>Description <span class="hint">(optional)</span></label><input type="text" name="description" placeholder="Brief description for staff"></div>
          <div class="field form-full">
            <label>Upload File <span class="hint">(uploads to S3)</span></label>
            <input type="file" name="file" accept=".pdf,.doc,.docx,.png,.jpg">
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

  <!-- Reset PW Modal -->
  <div id="reset-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.6); z-index:999; align-items:center; justify-content:center; padding:20px;">
    <div class="card" style="max-width:380px; width:100%;">
      <h3 id="reset-title" style="margin-bottom:16px;">Reset Password</h3>
      <form method="POST" action="/admin/guard/reset-password" class="portal-form">
        <input type="hidden" name="id" id="reset-id">
        <div class="field"><label>New Password <span class="hint">(min 8 chars)</span></label>
          <input type="password" name="new_password" required minlength="8">
        </div>
        <div style="display:flex;gap:12px;margin-top:8px;">
          <button type="submit" class="btn-primary">Reset</button>
          <button type="button" class="btn-secondary" onclick="document.getElementById('reset-modal').style.display='none'">Cancel</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    function showReset(id, name) {
      document.getElementById('reset-id').value = id;
      document.getElementById('reset-title').textContent = 'Reset Password — ' + name;
      document.getElementById('reset-modal').style.display = 'flex';
    }
    function showTab(event, name) {
      document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('tab-' + name).classList.add('active');
      event.target.classList.add('active');
    }
  </script>`;
}
