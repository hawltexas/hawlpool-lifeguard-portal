function showReset(id, name) {
  document.getElementById('reset-id').value = id;
  document.getElementById('reset-title').textContent = 'Reset Password — ' + name;
  document.getElementById('reset-modal').style.display = 'flex';
}

function showTab(e, name) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));

  const tab = document.getElementById('tab-' + name);
  if (!tab) {
    console.error('Missing tab:', name);
    return;
  }

  tab.classList.add('active');
  e.currentTarget.classList.add('active');
}
