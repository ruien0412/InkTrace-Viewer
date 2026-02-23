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

// --- Python-style Global SVG Scaling ---
// Mirrors the two-pass approach from the Python font builder:
// 1. Collect bounding boxes of all SVGs
// 2. Use 5th/95th percentile to get a stable crop window (exclude outliers)
// 3. Compute one global uniform square window for all glyphs
// 4. Per-SVG: use the global window, shift only if content is outside it

// Tokenize path d-string: [{cmd, val}, ...] — same regex as Python script
function parsePathTokens(d) {
  const regex = /([a-zA-Z])|([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  const tokens = [];
  let match;
  while ((match = regex.exec(d)) !== null) {
    if (match[1]) tokens.push({ cmd: match[1], val: null });
    else tokens.push({ cmd: null, val: parseFloat(match[2]) });
  }
  return tokens;
}

// Calculate bounding box by alternating X/Y on each value — mirrors Python calculate_bounding_box
function calculateBoundingBox(tokens) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let isX = true;
  for (const { cmd, val } of tokens) {
    if (cmd !== null) {
      isX = true; // reset on every command letter
    } else if (val !== null) {
      if (isX) {
        if (val < minX) minX = val;
        if (val > maxX) maxX = val;
        isX = false;
      } else {
        if (val < minY) minY = val;
        if (val > maxY) maxY = val;
        isX = true;
      }
    }
  }
  if (minX === Infinity) return null;
  return { minX, maxX, minY, maxY };
}

// Extract combined path d string from SVG content
function extractPathData(svgContent) {
  const matches = [...svgContent.matchAll(/\bd="([^"]+)"/g)];
  return matches.map(m => m[1]).join(' ');
}

// Compute per-SVG viewBox given the global window + this SVG's own bbox.
// Shifts the window only for outliers that fall outside the global crop.
function computeViewBox(bbox, globalOriginX, globalOriginY, uniformSquare) {
  if (!bbox) return null;
  const { minX, maxX, minY, maxY } = bbox;

  let vx = globalOriginX;
  let vy = globalOriginY;

  // Shift X if content is outside the global window
  if (minX < globalOriginX) {
    vx = minX;
  } else if (maxX > globalOriginX + uniformSquare) {
    vx = maxX - uniformSquare;
  }

  // Shift Y if content is outside the global window
  if (minY < globalOriginY) {
    vy = minY;
  } else if (maxY > globalOriginY + uniformSquare) {
    vy = maxY - uniformSquare;
  }

  return `${vx.toFixed(2)} ${vy.toFixed(2)} ${uniformSquare.toFixed(2)} ${uniformSquare.toFixed(2)}`;
}

// --- Recursive SVG Scanner (collect file paths only) ---
async function scanDirectory(dir) {
  let results = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
         results = results.concat(await scanDirectory(fullPath))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        results.push({ name: entry.name, path: fullPath })
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

  // Scan SVGs IPC — two-pass global scaling (mirrors Python font builder)
  ipcMain.handle('scan:svgs', async (_, dir) => {
    if (!dir) return []

    const files = await scanDirectory(dir)

    // --- First pass: read every SVG and collect its bounding box ---
    const fileData = []
    for (const file of files) {
      try {
        const content = await fs.readFile(file.path, 'utf8')
        const rawD = extractPathData(content)
        const bbox = rawD ? calculateBoundingBox(parsePathTokens(rawD)) : null
        fileData.push({ ...file, bbox })
      } catch (e) {
        console.warn(`Failed to read ${file.name}:`, e)
        fileData.push({ ...file, bbox: null })
      }
    }

    // --- Compute global 5th/95th percentile crop window ---
    const validBboxes = fileData.map(f => f.bbox).filter(Boolean)
    let globalOriginX = 0, globalOriginY = 0, uniformSquare = 1000

    if (validBboxes.length >= 2) {
      const allMinX = validBboxes.map(b => b.minX).sort((a, b) => a - b)
      const allMaxX = validBboxes.map(b => b.maxX).sort((a, b) => a - b)
      const allMinY = validBboxes.map(b => b.minY).sort((a, b) => a - b)
      const allMaxY = validBboxes.map(b => b.maxY).sort((a, b) => a - b)

      const n = validBboxes.length
      const lo = Math.max(0, Math.floor(n * 0.05))
      const hi = Math.min(n - 1, Math.floor(n * 0.95))

      const cropMinX = allMinX[lo]
      const cropMaxX = allMaxX[hi]
      const cropMinY = allMinY[lo]
      const cropMaxY = allMaxY[hi]

      const cropWidth  = cropMaxX - cropMinX
      const cropHeight = cropMaxY - cropMinY
      uniformSquare = Math.max(cropWidth, cropHeight)

      // Centre the shorter axis inside the square (same as Python)
      const cropCenterX = (cropMinX + cropMaxX) / 2
      const cropCenterY = (cropMinY + cropMaxY) / 2
      globalOriginX = cropCenterX - uniformSquare / 2
      globalOriginY = cropCenterY - uniformSquare / 2

      console.log(`[scan] 5%-95% X=[${cropMinX.toFixed(1)}, ${cropMaxX.toFixed(1)}] Y=[${cropMinY.toFixed(1)}, ${cropMaxY.toFixed(1)}]`)
      console.log(`[scan] uniformSquare=${uniformSquare.toFixed(1)} origin=(${globalOriginX.toFixed(1)}, ${globalOriginY.toFixed(1)})`)
    }

    // --- Second pass: assign per-file viewBox using global window ---
    return fileData.map(f => ({
      name: f.name,
      path: f.path,
      relativePath: path.relative(dir, f.path),
      viewBox: computeViewBox(f.bbox, globalOriginX, globalOriginY, uniformSquare),
    }))
  })

  // Read File IPC
  ipcMain.handle('file:read', async (_, filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      return content
    } catch (err) {
      console.error('Error reading file:', filePath, err)
      throw err
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
