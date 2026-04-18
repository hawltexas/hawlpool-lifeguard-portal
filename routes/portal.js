const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const AWS = require('aws-sdk');
const { pool } = require('../database');
const { requireLogin } = require('../middleware/auth');
const { renderPage } = require('../utils/render');

router.use(requireLogin);

function currentUser(req) {
  return {
    name: req.session.userName,
    isAdmin: req.session.isAdmin,
    isOperationsAdmin: req.session.isOperationsAdmin,
  };
}

router.get('/', async (req, res) => {
  const user = currentUser(req);
  try {
    const [annRes, schedRes, payRes, docsRes] = await Promise.all([
      pool.query('SELECT * FROM announcements WHERE is_active = true ORDER BY created_at DESC LIMIT 5'),
      pool.query(`SELECT * FROM schedule_events WHERE is_active = true AND event_date >= CURRENT_DATE ORDER BY event_date ASC LIMIT 5`),
      pool.query(`SELECT * FROM pay_schedule WHERE is_active = true AND pay_date >= CURRENT_DATE - interval '7 days' ORDER BY pay_date ASC LIMIT 3`),
      pool.query(`SELECT * FROM documents WHERE is_active = true ORDER BY uploaded_at DESC LIMIT 4`),
    ]);
    res.send(renderPage('Dashboard', dashboardHTML(user, annRes.rows, schedRes.rows, payRes.rows, docsRes.rows), user));
  } catch (err) {
    console.error('Dashboard error:', err);
    res.send(renderPage('Dashboard', dashboardHTML(user, [], [], [], []), user));
  }
});

router.get('/schedule', async (req, res) => {
  const user = currentUser(req);
  try {
    const result = await pool.query(
      `SELECT * FROM schedule_events WHERE is_active = true ORDER BY event_date ASC, start_time ASC`
    );
    res.send(renderPage('Schedule', scheduleHTML(result.rows), user));
  } catch (err) {
    console.error(err);
    res.send(renderPage('Schedule', scheduleHTML([]), user));
  }
});

router.get('/pay', async (req, res) => {
  const user = currentUser(req);
  try {
    const result = await pool.query(
      `SELECT * FROM pay_schedule WHERE is_active = true ORDER BY pay_date ASC`
    );
    res.send(renderPage('Pay Schedule', payHTML(result.rows), user));
  } catch (err) {
    console.error(err);
    res.send(renderPage('Pay Schedule', payHTML([]), user));
  }
});

router.get('/documents', async (req, res) => {
  const user = currentUser(req);
  try {
    const result = await pool.query(
      `SELECT * FROM documents WHERE is_active = true ORDER BY category, uploaded_at DESC`
    );
    const grouped = {};
    result.rows.forEach(doc => {
      if (!grouped[doc.category]) grouped[doc.category] = [];
      grouped[doc.category].push(doc);
    });
    res.send(renderPage('Documents', documentsHTML(grouped), user));
  } catch (err) {
    console.error(err);
    res.send(renderPage('Documents', documentsHTML({}), user));
  }
});

router.get('/document/:id', async (req, res) => {
  try {
    const docRes = await pool.query(
      'SELECT * FROM documents WHERE id = $1 AND is_active = true',
      [req.params.id]
    );
    const doc = docRes.rows[0];
    if (!doc) return res.status(404).send('Document not found.');

    const isS3 = doc.filename && !doc.filename.startsWith('/') && !doc.filename.includes('\\');
    const looksLocal = fs.existsSync(path.join(__dirname, '..', 'public', 'documents', path.basename(doc.filename)));

    if (isS3 && !looksLocal && process.env.S3_BUCKET_NAME) {
      const s3 = new AWS.S3({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION,
      });
      const url = s3.getSignedUrl('getObject', {
        Bucket: process.env.S3_BUCKET_NAME,
        Key: doc.filename,
        Expires: 300,
      });
      return res.redirect(url);
    }

    const safeFilename = path.basename(doc.filename);
    const filePath = path.join(__dirname, '..', 'public', 'documents', safeFilename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found on server.');

    const ext = path.extname(safeFilename).toLowerCase();
    if (ext === '.pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
    } else {
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(filePath);
  } catch (err) {
    console.error('Document error:', err);
    res.status(500).send('Internal server error.');
  }
});

module.exports = router;

function dashboardHTML(user, announcements, schedule, payDates, docs) {
  const adminBanner = user.isAdmin ? `
    <div class="admin-banner">
      <span>Admin Access Enabled</span>
      <a href="/admin">Manage Portal -></a>
    </div>` : '';

  const annSection = announcements.length ? announcements.map(a => `
    <div class="announcement priority-${a.priority || 'normal'}">
      <div class="ann-header">
        <span class="ann-priority-dot"></span>
        <strong>${a.title}</strong>
        <span class="ann-date">${fmtDate(a.created_at)}</span>
      </div>
      <p class="ann-body">${a.body}</p>
      ${a.author ? `<span class="ann-author">- ${a.author}</span>` : ''}
    </div>`).join('') :
    `<p class="empty-state">No announcements right now. Check back soon.</p>`;

  const schedSection = schedule.length ? `<div class="event-list">${schedule.map(e => `
    <div class="event-item">
      <div class="event-date-block">
        <span class="event-month">${fmtMonth(e.event_date)}</span>
        <span class="event-day">${fmtDay(e.event_date)}</span>
      </div>
      <div class="event-info">
        <strong>${e.title}</strong>
        ${e.start_time ? `<span class="event-time">Time: ${e.start_time}${e.end_time ? ' - ' + e.end_time : ''}</span>` : ''}
        ${e.location ? `<span class="event-loc">Location: ${e.location}</span>` : ''}
        ${e.description ? `<span class="event-desc">${e.description}</span>` : ''}
      </div>
    </div>`).join('')}</div>` :
    `<p class="empty-state">No upcoming events.</p>`;

  const paySection = payDates.length ? payDates.map(p => `
    <div class="pay-item">
      <span class="pay-label">${p.period_label}</span>
      <span class="pay-date">Pay Date: ${fmtDate(p.pay_date)}</span>
      ${p.notes ? `<span class="pay-notes">${p.notes}</span>` : ''}
    </div>`).join('') :
    `<p class="empty-state">No upcoming pay dates on file.</p>`;

  const docsSection = docs.length ? `<div class="doc-grid-sm">${docs.map(d => `
    <a href="/portal/document/${d.id}" class="doc-card-sm" target="_blank" rel="noopener">
      <span class="doc-icon-sm">Doc</span>
      <span class="doc-title-sm">${d.title}</span>
    </a>`).join('')}
    <a href="/portal/documents" class="doc-card-sm doc-more">View all documents -></a>
  </div>` : `<p class="empty-state">No documents uploaded yet. <a href="/portal/documents">Browse documents</a></p>`;

  return `
  <div class="portal-wrap">
    ${adminBanner}
    <div class="dash-welcome">
      <div class="welcome-text">
        <h1>Hey, ${user.name.split(' ')[0]}</h1>
        <p>Welcome to the HAWL Staff Portal. Announcements, schedules, pay dates, and documents for the Hideaway team are all in one place.</p>
      </div>
      <a href="/auth/change-password" class="btn-secondary btn-sm-link">Change Password</a>
    </div>

    <div class="dash-grid">
      <div class="dash-col dash-col-main">
        <section class="dash-section">
          <div class="section-header">
            <h2>Announcements</h2>
          </div>
          <div class="ann-list">${annSection}</div>
        </section>

        <section class="dash-section">
          <div class="section-header">
            <h2>Upcoming Schedule</h2>
            <a href="/portal/schedule" class="section-link">View all -></a>
          </div>
          ${schedSection}
        </section>
      </div>

      <div class="dash-col dash-col-side">
        <section class="dash-section">
          <div class="section-header">
            <h2>Next Pay Dates</h2>
            <a href="/portal/pay" class="section-link">Full schedule -></a>
          </div>
          <div class="pay-list">${paySection}</div>
        </section>

        <section class="dash-section">
          <div class="section-header">
            <h2>Quick Documents</h2>
            <a href="/portal/documents" class="section-link">All docs -></a>
          </div>
          ${docsSection}
        </section>

        <section class="dash-section info-section">
          <h2>Important Contacts</h2>
          <div class="contact-list">
            <div class="contact-item">
              <span class="contact-role">Operations Office</span>
              <a href="tel:+19725231685" class="contact-val">(972) 523-1685</a>
            </div>
            <div class="contact-item">
              <span class="contact-role">Emergency</span>
              <a href="tel:911" class="contact-val contact-emergency">911</a>
            </div>
            <div class="contact-item">
              <span class="contact-role">Email</span>
              <a href="mailto:jennifer@hawlpool.com" class="contact-val">jennifer@hawlpool.com</a>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>`;
}

function scheduleHTML(events) {
  const grouped = {};
  events.forEach(e => {
    const key = fmtDate(e.event_date);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(e);
  });

  const content = Object.keys(grouped).length ? Object.entries(grouped).map(([date, evts]) => `
    <div class="sched-day">
      <div class="sched-date-header">${date}</div>
      ${evts.map(e => `
        <div class="sched-event">
          <div class="sched-event-title">${e.title}</div>
          ${e.start_time ? `<div class="sched-event-meta">Time: ${e.start_time}${e.end_time ? ' - ' + e.end_time : ''}</div>` : ''}
          ${e.location ? `<div class="sched-event-meta">Location: ${e.location}</div>` : ''}
          ${e.description ? `<div class="sched-event-desc">${e.description}</div>` : ''}
        </div>`).join('')}
    </div>`).join('') : `<div class="empty-card">No upcoming events or shifts scheduled. Check back soon.</div>`;

  return `
  <div class="portal-wrap">
    <div class="page-header">
      <h1>Schedule and Events</h1>
      <p class="page-sub">Upcoming shifts, training dates, and staff events.</p>
    </div>
    <div class="sched-list">${content}</div>
  </div>`;
}

function payHTML(rows) {
  const now = new Date();
  const content = rows.length ? `
    <div class="pay-table-wrap">
      <table class="pay-table">
        <thead>
          <tr>
            <th>Pay Period</th>
            <th>Pay Date</th>
            <th>Notes</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(p => {
            const isPast = new Date(p.pay_date) < now;
            const isNear = !isPast && (new Date(p.pay_date) - now) < 7 * 24 * 60 * 60 * 1000;
            const status = isPast ? '<span class="badge badge-paid">Paid</span>'
              : isNear ? '<span class="badge badge-upcoming">Upcoming</span>'
              : '<span class="badge badge-future">Scheduled</span>';
            return `
            <tr class="${isPast ? 'row-past' : ''}">
              <td><strong>${p.period_label}</strong></td>
              <td>${fmtDate(p.pay_date)}</td>
              <td>${p.notes || '-'}</td>
              <td>${status}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>` : `<div class="empty-card">Pay schedule not yet posted. Contact your manager for pay information.</div>`;

  return `
  <div class="portal-wrap">
    <div class="page-header">
      <h1>Pay Schedule</h1>
      <p class="page-sub">Your pay dates and period information. Questions? Email <a href="mailto:brant@brantborden.com">brant@brantborden.com</a>.</p>
    </div>
    <div class="info-card">
      <strong>Pay Info:</strong> Hideaway staff are paid bi-weekly via direct deposit. Make sure your banking info is on file with management.
    </div>
    ${content}
  </div>`;
}

function documentsHTML(grouped) {
  const categoryLabels = {
    policy: 'Policies and Procedures',
    training: 'Training and Certification',
    forms: 'Forms and Applications',
    emergency: 'Emergency Protocols',
    general: 'General Documents',
  };

  const content = Object.keys(grouped).length ? Object.entries(grouped).map(([cat, docs]) => `
    <div class="doc-section">
      <h3 class="doc-category-label">${categoryLabels[cat] || cat}</h3>
      <div class="doc-grid">
        ${docs.map(d => `
          <a href="/portal/document/${d.id}" class="doc-card" target="_blank" rel="noopener">
            <span class="doc-icon">Doc</span>
            <div class="doc-info">
              <span class="doc-title">${d.title}</span>
              ${d.description ? `<span class="doc-desc">${d.description}</span>` : ''}
              <span class="doc-action">Open -></span>
            </div>
          </a>`).join('')}
      </div>
    </div>`).join('') :
    `<div class="empty-card">No documents have been uploaded yet. Contact your manager for staff materials.</div>`;

  return `
  <div class="portal-wrap">
    <div class="page-header">
      <h1>Documents</h1>
      <p class="page-sub">Policies, training materials, forms, and emergency protocols.</p>
    </div>
    <div class="doc-sections">${content}</div>
  </div>`;
}

function fmtDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function fmtMonth(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
}

function fmtDay(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' });
}
