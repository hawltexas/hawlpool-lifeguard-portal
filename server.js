const express = require('express');
const session = require('express-session');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const path    = require('path');
const fs      = require('fs');

const { initialize } = require('./database');
const authRoutes   = require('./routes/auth');
const portalRoutes = require('./routes/portal');
const adminRoutes  = require('./routes/admin');

const app  = express();
const PORT = process.env.PORT || 10000;

app.set('trust proxy', 1);

// ── Body parsing ──────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ── Security headers ──────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc:    ["'self'", "https://fonts.gstatic.com"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:"],
    }
  }
}));

// ── Rate limiting ─────────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many login attempts. Please try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

// ── Session store ─────────────────────────────────────────────────────
if (!fs.existsSync('./data')) fs.mkdirSync('./data');
const SQLiteStore = require('connect-sqlite3')(session);

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: './data' }),
  secret: process.env.SESSION_SECRET || 'hawl-staff-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000, // 8 hours (shift length)
  },
}));

// ── Static files ──────────────────────────────────────────────────────
app.use('/public', express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────
app.use('/auth', loginLimiter, authRoutes);
app.use('/portal', portalRoutes);
app.use('/admin', adminRoutes);

app.get('/', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/portal');
  res.redirect('/auth/login');
});

// 404
app.use((req, res) => {
  const { renderPage } = require('./utils/render');
  res.status(404).send(renderPage('Not Found',
    `<div class="portal-wrap"><div class="card" style="max-width:400px;margin:80px auto;text-align:center;">
      <h2 style="margin-bottom:12px;">Page not found</h2>
      <a href="/" class="btn-primary" style="display:inline-block;">Return to Login</a>
    </div></div>`
  ));
});

// ── Start ─────────────────────────────────────────────────────────────
process.on('uncaughtException', err => console.error('Uncaught:', err));
process.on('unhandledRejection', err => console.error('Unhandled:', err));

(async () => {
  try {
    await initialize();
    app.listen(PORT, () => console.log(`HAWL Staff Portal running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
})();
