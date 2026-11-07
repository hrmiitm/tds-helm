// desktop-app/renderer.js — Connection Screen Logic
(async () => {
  const statusBox = document.getElementById('statusBox');
  const statusText = document.getElementById('statusText');
  const spinner = document.getElementById('spinner');
  const retryBtn = document.getElementById('retryBtn');
  const hubUrlInput = document.getElementById('hubUrlInput');
  const errorMsg = document.getElementById('errorMsg');
  const copyBtn = document.getElementById('copyBtn');

  // Copy docker run command
  copyBtn.addEventListener('click', () => {
    const code = document.querySelector('.code-box code').textContent;
    navigator.clipboard.writeText(code);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
  });

  // Get current configured URL
  if (window.ragDesktop) {
    const currentUrl = await window.ragDesktop.getHubUrl();
    if (currentUrl) {
      hubUrlInput.value = currentUrl;
    }
  }

  async function checkAndConnect() {
    const url = hubUrlInput.value.trim();
    errorMsg.textContent = '';
    spinner.style.display = 'block';
    statusText.textContent = `Connecting to ${url}...`;

    if (!window.ragDesktop) {
      statusText.textContent = 'Running outside Electron desktop wrapper.';
      return;
    }

    const setRes = await window.ragDesktop.setHubUrl(url);
    if (!setRes.success) {
      spinner.style.display = 'none';
      statusText.textContent = 'Invalid URL configuration.';
      errorMsg.textContent = setRes.error;
      return;
    }

    const isAlive = await window.ragDesktop.checkConnection(url);
    if (isAlive) {
      statusText.textContent = 'Connected! Loading RAG Studio...';
      await window.ragDesktop.connectToHub(url);
    } else {
      spinner.style.display = 'none';
      statusText.textContent = 'Hub is offline or starting up. Retrying in 4s...';
      setTimeout(checkAndConnect, 4000);
    }
  }

  retryBtn.addEventListener('click', () => {
    checkAndConnect();
  });

  // Initial check
  checkAndConnect();
})();

