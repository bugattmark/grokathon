// Check backend status
async function checkBackend() {
  const statusEl = document.getElementById('backendStatus');
  const providerEl = document.getElementById('provider');

  try {
    const response = await fetch('http://localhost:3000/health');
    const data = await response.json();

    statusEl.textContent = 'Connected';
    statusEl.className = 'status-value active';
    providerEl.textContent = data.provider || 'unknown';

  } catch (error) {
    statusEl.textContent = 'Offline';
    statusEl.className = 'status-value inactive';
    providerEl.textContent = '-';
  }
}

// Check on load
checkBackend();
