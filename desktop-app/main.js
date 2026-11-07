// desktop-app/main.js — Native Electron Wrapper for RAG Studio v4.0
// Strict adherence to spec.md Section 10: Security, Menu Accelerator Bypassing, and Safe Navigation.

const { app, BrowserWindow, Menu, shell, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const https = require('https');

let mainWindow = null;
let currentHubUrl = process.env.RAG_STUDIO_URL || 'http://localhost:8080';

// Invariant: Validate target URL strictly
function validateHubUrl(inputUrl) {
  try {
    const parsed = new URL(inputUrl);
    if (parsed.protocol === 'http:') {
      const isLoopback = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
      if (!isLoopback) {
        return { valid: false, error: 'Plain HTTP is only allowed for loopback addresses (localhost/127.0.0.1).' };
      }
    } else if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Protocol must be http:// (loopback only) or https://' };
    }
    if (parsed.username || parsed.password) {
      return { valid: false, error: 'Credentials in URL are strictly prohibited.' };
    }
    return { valid: true, url: parsed.origin + (parsed.pathname === '/' ? '' : parsed.pathname) };
  } catch (e) {
    return { valid: false, error: 'Malformed URL format.' };
  }
}

// Check hub health via lightweight probe
function checkHubHealth(targetUrl, callback) {
  try {
    const parsed = new URL(targetUrl);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.get(`${parsed.origin}/health/live`, { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          callback(json.status === 'live');
        } catch {
          callback(res.statusCode === 200);
        }
      });
    });
    req.on('error', () => callback(false));
    req.on('timeout', () => {
      req.destroy();
      callback(false);
    });
  } catch {
    callback(false);
  }
}

function createApplicationMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload Hub',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.reload();
          }
        },
        {
          label: 'Force Reload Hub',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) mainWindow.webContents.reloadIgnoringCache();
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          }
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'RAG Studio Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/google/rag-studio');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'RAG Studio',
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  createApplicationMenu();

  // Spec Section 10.2: Transparent keyboard shortcut forwarding
  // Prevents Electron from trapping Ctrl+W, Ctrl+P, Ctrl+N so inner VS Code receives them!
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const editorShortcut = (input.control || input.meta) && ['w', 'p', 'n'].includes(key);
    
    // Ignore Electron menu shortcuts when editor hotkeys are detected
    mainWindow.webContents.setIgnoreMenuShortcuts(editorShortcut);

    // Fullscreen toggle via F11
    if (input.type === 'keyDown' && !input.isAutoRepeat && input.key === 'F11') {
      event.preventDefault();
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
  });

  // Guard navigation: Safe external link handling
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        // Open documentation or external links in host default browser
        shell.openExternal(url);
      }
    } catch (e) {}
    return { action: 'deny' };
  });

  // Load connection screen initially while probing hub
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Initial connect probe with cache-busting
  checkHubHealth(currentHubUrl, async (isHealthy) => {
    if (isHealthy && mainWindow) {
      try {
        await mainWindow.webContents.session.clearCache();
      } catch (e) {}
      mainWindow.loadURL(currentHubUrl, {
        extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n'
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers for Connection UI (via safe preload)
ipcMain.handle('get-hub-url', () => currentHubUrl);

ipcMain.handle('set-hub-url', (event, newUrl) => {
  const result = validateHubUrl(newUrl);
  if (!result.valid) {
    return { success: false, error: result.error };
  }
  currentHubUrl = result.url;
  return { success: true, url: currentHubUrl };
});

ipcMain.handle('check-connection', async (event, testUrl) => {
  const target = testUrl || currentHubUrl;
  return new Promise((resolve) => {
    checkHubHealth(target, (alive) => resolve(alive));
  });
});

ipcMain.handle('connect-to-hub', async (event, targetUrl) => {
  const target = targetUrl || currentHubUrl;
  const val = validateHubUrl(target);
  if (!val.valid) return { success: false, error: val.error };
  currentHubUrl = val.url;
  if (mainWindow) {
    try {
      await mainWindow.webContents.session.clearCache();
    } catch (e) {}
    mainWindow.loadURL(currentHubUrl, {
      extraHeaders: 'pragma: no-cache\ncache-control: no-cache\n'
    });
  }
  return { success: true };
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

