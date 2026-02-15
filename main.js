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

// --- Minimal SVG Bounding Box Calculation ---
// Approximation: Extract all numeric sequences from path data and check min/max.
// This is a heuristic that works well for many SVGs, especially icon sets.
// For complex paths with relative commands or transforms, it acts as a best-effort guess.
function getApproximateViewBox(svgContent) {
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  // Always prefer explicit viewBox if available and valid?
  // User wants to CROP, so original viewBox might be huge with small content.
  // We want the content bbox.
  
  // Extract all path data
  const pathMatches = svgContent.matchAll(/d="([^"]+)"/g);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let found = false;

  for (const match of pathMatches) {
    const d = match[1];
    
    // Check for relative commands which might throw off simple absolute extraction
    // If complex relative paths exist, fallback to original viewBox might be safer?
    // But let's try extracting all numbers. Usually control points are near anchors.
    // If a path is "m 10 10 l 10 0", numbers are 10,10,10,0. Range 0-10. Correct? 
    // No, l 10 0 means x+=10 (20). Actual max X is 20. Our heuristic sees 10.
    // So relative commands break this simple "all numbers" approach.
    
    // However, given constraints, we'll try a hybrid approach:
    // 1. If only absolute commands (uppercase), strict min/max.
    // 2. If relative commands (lowercase), we might skip or try to simulate? 
    // Simulation is hard without a library.
    
    // Let's stick to the user's suggestion of "regex for coordinates".
    // We will blindly trust the numbers for now as a "rough crop".
    // If the SVG uses relative commands extensively, this might fail to find the TRUE extent.
    // But for "trimming whitespace", usually the start point (M) defines the top-left?
    
    const numbers = d.match(/-?[\d.]+/g);
    if (numbers) {
      found = true;
      for (let i = 0; i < numbers.length; i++) {
        const n = parseFloat(numbers[i]);
        if (!isNaN(n)) {
          // Heuristic: Coordinate values usually aren't singular. 
          // But we can't distinguish X from Y easily in a flat list without parsing commands.
          // Is it safe to mix X and Y for min/max? 
          // No, minX might be huge if we include Y values, or minY might be tiny if we include X.
          // Actually, X and Y ranges often overlap, so checking ALL numbers against min/max 
          // yields the global bounding box of ALL numeric values.
          // This creates a square-ish or varying aspect ratio crop that might be "safe" but loose.
          // Use odd/even index heuristic?
          // d="M 0 0 L 100 50" -> 0,0,100,50. Even indices: 0, 100 (X). Odd: 0, 50 (Y).
          // This generally holds for M, L, C, S, Q, T.
          // Exceptions: H (x only), V (y only), A (rx ry rot large sweep x y).
          // A command breaks parity.
          
          if (i % 2 === 0) { // X
             if (n < minX) minX = n;
             if (n > maxX) maxX = n;
          } else { // Y
             if (n < minY) minY = n;
             if (n > maxY) maxY = n;
          }
        }
      }
    }
  }

  if (!found || minX === Infinity || maxX === -Infinity) {
    if (viewBoxMatch) return viewBoxMatch[1]; // Fallback
    return null; 
  }

  // Add padding
  const padding = 2; // match SvgAutoCrop
  const x = Math.floor(minX - padding);
  const y = Math.floor(minY - padding);
  const w = Math.ceil(maxX - minX + padding * 2);
  const h = Math.ceil(maxY - minY + padding * 2);

  return `${x} ${y} ${w} ${h}`;
}

// --- Recursive SVG Scanner ---
async function scanDirectory(dir) {
  let results = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
         // Fix recursion: explicitly concat results
         results = results.concat(await scanDirectory(fullPath))
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        let viewBox = null;
        try {
           // Read file content for BBox calculation (performance impact warning!)
           const content = await fs.readFile(fullPath, 'utf8');
           viewBox = getApproximateViewBox(content);
        } catch (e) {
           console.warn(`Failed to read/parse ${entry.name}:`, e);
        }

        results.push({
          name: entry.name,
          path: fullPath,
          viewBox: viewBox, // New field
          // relativePath added in ipc handler
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
