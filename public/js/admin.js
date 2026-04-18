function showReset(id, name) {
  const resetId = document.getElementById('reset-id');
  const resetTitle = document.getElementById('reset-title');
  const resetModal = document.getElementById('reset-modal');

  if (!resetId || !resetTitle || !resetModal) return;

  resetId.value = id;
  resetTitle.textContent = 'Reset Password - ' + name;
  resetModal.style.display = 'flex';
}

function activateTab(button, name) {
  const tab = document.getElementById('tab-' + name);
  if (!button || !tab) {
    console.error('Missing tab target:', name);
    return;
  }

  document.querySelectorAll('.tab-content').forEach(panel => panel.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(tabButton => tabButton.classList.remove('active'));

  tab.classList.add('active');
  button.classList.add('active');
}

function showTab(eventOrButton, name) {
  const button = eventOrButton && eventOrButton.currentTarget ? eventOrButton.currentTarget : eventOrButton;
  activateTab(button, name);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-btn[data-tab]').forEach(button => {
    button.addEventListener('click', () => activateTab(button, button.dataset.tab));
  });
});

window.showReset = showReset;
window.showTab = showTab;
