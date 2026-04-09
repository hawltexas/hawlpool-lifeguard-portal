function renderPage(title, bodyHTML, user = null) {
  const isAdmin = user && user.isAdmin;
  const navLinks = user ? `
    <div class="nav-links">
      <a href="/portal" class="nav-link">Dashboard</a>
      <a href="/portal/schedule" class="nav-link">Schedule</a>
      <a href="/portal/pay" class="nav-link">Pay</a>
      <a href="/portal/documents" class="nav-link">Documents</a>
      ${isAdmin ? '<a href="/admin" class="nav-link nav-admin">Admin</a>' : ''}
    </div>
    <div class="nav-right">
      <span class="nav-user">${user.name}</span>
      <a href="/auth/logout" class="nav-logout">Sign Out</a>
    </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>${title} | HAWL Pool Lifeguard Portal</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;800&family=Barlow:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/public/css/portal.css">
</head>
<body>
  <nav class="topnav" id="topnav">
    <div class="topnav-inner">
      <a href="/" class="wordmark">
        <span class="wordmark-logo">🏊</span>
        <div class="wordmark-text">
          <span class="wordmark-top">HAWL Pool</span>
          <span class="wordmark-sub">Lifeguard Portal</span>
        </div>
      </a>
      ${user ? `<button class="nav-toggle" id="navToggle" aria-label="Menu">&#9776;</button>` : ''}
      <div class="nav-content" id="navContent">${navLinks}</div>
    </div>
  </nav>
  <main>${bodyHTML}</main>
  <footer class="portal-footer">
    <div class="footer-inner">
      <span>&copy; 2026 HAWL Pool &mdash; The Hideaway at Walnut Lake. All rights reserved.</span>
      <span>Staff use only &mdash; Confidential</span>
    </div>
  </footer>
  <script>
    const toggle = document.getElementById('navToggle');
    const navContent = document.getElementById('navContent');
    if (toggle) {
      toggle.addEventListener('click', () => {
        navContent.classList.toggle('open');
        toggle.textContent = navContent.classList.contains('open') ? '✕' : '☰';
      });
    }
    // Close nav on link click (mobile)
    document.querySelectorAll('.nav-link').forEach(l => l.addEventListener('click', () => {
      if (navContent) navContent.classList.remove('open');
      if (toggle) toggle.textContent = '☰';
    }));
  </script>
</body>
</html>`;
}

module.exports = { renderPage };
