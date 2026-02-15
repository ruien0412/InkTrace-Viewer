const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const simpleGit = require('simple-git')

// --- Settings Management (Preserved) ---
function getSettingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

async function readSettings() {
  try {
    const raw = await fs.readFile(getSettingsFilePath(), 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    return { history: [], lastUsed: null }
  }
}

async function saveSettings(settings) {
  const settingsPath = getSettingsFilePath()
  await fs.mkdir(path.dirname(settingsPath), { recursive: true })
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}

// --- Recursive SVG Scanner ---
async function scanDirectory(dir) {
  let results = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        results = results.concat(await scanDirectory(fullPath))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        results.push({
          name: entry.name,
          path: fullPath,
          relativePath: fullPath // Will be processed in frontend or relative to root
        })
      }
    }
  } catch (err) {
    console.error('Error scanning directory:', dir, err)
  }
  return results
}

// --- Main Window ---
function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false // Consider removing for production, but needed for file:// access in dev
    }
  })

  const isDev = process.env.NODE_ENV === 'development'
  
  if (isDev) {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }
}

// --- App Lifecycle ---
app.whenReady().then(() => {
  // Settings IPC
  ipcMain.handle('settings:get', readSettings)
  
  // Dialog IPC
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  // Git Operations IPC
  ipcMain.handle('git:operation', async (event, { repoUrl, localPath }) => {
    if (!repoUrl || !localPath) return { success: false, message: 'Missing parameters' }
    
    // Save settings immediately
    const settings = await readSettings()
    settings.lastUsed = { repoUrl, destinationFolder: localPath }
    await saveSettings(settings)

    try {
      let gitCheck;
      try {
        await fs.access(localPath)
        gitCheck = simpleGit(localPath)
      } catch {
        // Directory doesn't exist
        gitCheck = simpleGit()
      }

      event.sender.send('status:update', `Checking folder: ${localPath}...`)
      
      const exists = await fs.stat(localPath).catch(() => false)
      
      if (!exists) {
        // Clone new
        event.sender.send('status:update', `Cloning ${repoUrl}...`)
        await simpleGit().clone(repoUrl, localPath)
        return { success: true, message: 'Repository cloned successfully.' }
      } else {
        // Check if valid repo
        const isRepo = await gitCheck.checkIsRepo()
        if (isRepo) {
          event.sender.send('status:update', `Updating repository...`)
          await gitCheck.pull()
          return { success: true, message: 'Repository updated successfully.' }
        } else {
          // Folder exists but not a repo - check if empty
          const files = await fs.readdir(localPath)
          if (files.length === 0) {
            event.sender.send('status:update', `Cloning into empty folder...`)
            await simpleGit().clone(repoUrl, localPath)
            return { success: true, message: 'Repository cloned successfully.' }
          }
          return { success: false, message: 'Folder exists and is not a git repository.' }
        }
      }
    } catch (err) {
      return { success: false, message: `Git Error: ${err.message}` }
    }
  })

  // Scan SVGs IPC
  ipcMain.handle('scan:svgs', async (_, dir) => {
    if (!dir) return []
    const files = await scanDirectory(dir)
    // Make paths relative for display if needed, but absolute is fine for file://
    return files.map(f => ({
      ...f,
      relativePath: path.relative(dir, f.path)
    }))
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
