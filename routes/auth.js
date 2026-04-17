const express = require('express');
const bcrypt  = require('bcryptjs');
const router  = express.Router();
const { pool } = require('../database');
const { renderPage } = require('../utils/render');

router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/portal');
  const error = req.session.loginError || null;
  delete req.session.loginError;
  res.send(renderPage('Staff Login', loginHTML(error)));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.session.loginError = 'Please enter your email and password.';
    return res.redirect('/auth/login');
  }
  try {
    const result = await pool.query(
      'SELECT * FROM lifeguards WHERE email = $1 AND is_active = true',
      [email.toLowerCase().trim()]
    );
    const guard = result.rows[0];
    if (!guard || !bcrypt.compareSync(password, guard.password)) {
      req.session.loginError = 'Invalid credentials. Please try again.';
      return res.redirect('/auth/login');
    }
    req.session.regenerate(async (err) => {
      if (err) return res.redirect('/auth/login');
      req.session.userId   = guard.id;
      req.session.userName = guard.name;
      req.session.isAdmin  = !!guard.is_admin;
      await pool.query('UPDATE lifeguards SET last_login = NOW() WHERE id = $1', [guard.id]);
      const returnTo = req.session.returnTo || '/portal';
      delete req.session.returnTo;
      res.redirect(returnTo);
    });
  } catch (err) {
    console.error('Login error:', err);
    req.session.loginError = 'Something went wrong. Please try again.';
    res.redirect('/auth/login');
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

router.get('/change-password', (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const msg = req.session.pwMsg || null;
  delete req.session.pwMsg;
  res.send(renderPage('Change Password', changePwHTML(msg), { name: req.session.userName, isAdmin: req.session.isAdmin }));
});

router.post('/change-password', async (req, res) => {
  if (!req.session.userId) return res.redirect('/auth/login');
  const { current_password, new_password, confirm_password } = req.body;
  if (new_password !== confirm_password) {
    req.session.pwMsg = { type: 'error', text: 'New passwords do not match.' };
    return res.redirect('/auth/change-password');
  }
  if (new_password.length < 8) {
    req.session.pwMsg = { type: 'error', text: 'New password must be at least 8 characters.' };
    return res.redirect('/auth/change-password');
  }
  try {
    const result = await pool.query('SELECT * FROM lifeguards WHERE id = $1', [req.session.userId]);
    const guard = result.rows[0];
    if (!bcrypt.compareSync(current_password, guard.password)) {
      req.session.pwMsg = { type: 'error', text: 'Current password is incorrect.' };
      return res.redirect('/auth/change-password');
    }
    const hash = bcrypt.hashSync(new_password, 12);
    await pool.query('UPDATE lifeguards SET password = $1 WHERE id = $2', [hash, guard.id]);
    req.session.pwMsg = { type: 'success', text: 'Password updated successfully.' };
    res.redirect('/auth/change-password');
  } catch (err) {
    console.error('Change password error:', err);
    req.session.pwMsg = { type: 'error', text: 'Something went wrong.' };
    res.redirect('/auth/change-password');
  }
});

module.exports = router;

function loginHTML(error) {
  const errBlock = error ? `<div class="alert alert-error">${error}</div>` : '';
  return `
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-hero">
        <div class="login-wave"></div>
        <span class="login-icon">🏊</span>
        <span class="login-badge">STAFF ONLY</span>
        <h1 class="login-title">Lifeguard Portal</h1>
        <p class="login-sub">Hideaway Lake Club Pool</p>
      </div>
      <div class="login-body">
        ${errBlock}
        <form method="POST" action="/auth/login" class="portal-form">
          <div class="field">
            <label>Email Address</label>
            <input type="email" name="email" required placeholder="you@example.com" autocomplete="email">
          </div>
          <div class="field">
            <label>Password</label>
            <input type="password" name="password" required placeholder="••••••••" autocomplete="current-password">
          </div>
          <button type="submit" class="btn-primary btn-block">Sign In to Portal</button>
        </form>
        <p class="login-footer-note">Issues logging in? Contact <a href="mailto:brant@hawlpool.com">brant@hawlpool.com</a></p>
      </div>
    </div>
  </div>`;
}

function changePwHTML(msg) {
  const msgBlock = msg ? `<div class="alert alert-${msg.type}">${msg.text}</div>` : '';
  return `
  <div class="portal-wrap">
    <div class="page-header">
      <a href="/portal" class="back-link">&#8592; Back to Dashboard</a>
      <h1>Change Password</h1>
    </div>
    ${msgBlock}
    <div class="card" style="max-width:440px;">
      <form method="POST" action="/auth/change-password" class="portal-form">
        <div class="field">
          <label>Current Password</label>
          <input type="password" name="current_password" required placeholder="Current password">
        </div>
        <div class="field">
          <label>New Password <span class="hint">(min 8 chars)</span></label>
          <input type="password" name="new_password" required minlength="8" placeholder="New password">
        </div>
        <div class="field">
          <label>Confirm New Password</label>
          <input type="password" name="confirm_password" required placeholder="Confirm new password">
        </div>
        <button type="submit" class="btn-primary">Update Password</button>
      </form>
    </div>
  </div>`;
}
