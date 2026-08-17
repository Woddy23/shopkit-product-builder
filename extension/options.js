const apiKeyInput = document.getElementById('api-key');
const modelInput = document.getElementById('model');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save');

function setStatus(message) {
  statusEl.textContent = message;
  if (message) {
    setTimeout(() => {
      statusEl.textContent = '';
    }, 3000);
  }
}

async function loadOptions() {
  const { apiKey = '', model = 'gpt-5.6-luna' } = await chrome.storage.local.get(['apiKey', 'model']);
  apiKeyInput.value = apiKey;
  modelInput.value = model;
}

async function saveOptions() {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || 'gpt-5.6-luna';
  await chrome.storage.local.set({ apiKey, model });
  setStatus('Saved');
}

saveBtn.addEventListener('click', () => {
  saveOptions();
});

loadOptions();
