const { app, BrowserWindow, dialog, ipcMain } = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const { constants: fsConstants } = require('node:fs')
const { spawn } = require('node:child_process')
const os = require('node:os')
const crypto = require('node:crypto')

const cloneJobs = new Map()

function sendCloneEvent(targetWindow, channel, payload) {
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send(channel, payload)
  }
}

function parseRepoName(repoUrl) {
  const cleanedUrl = repoUrl.replace(/\/+$/, '')
  const lastSegment = cleanedUrl.split('/').pop() || 'repository'
  return lastSegment.endsWith('.git') ? lastSegment.slice(0, -4) : lastSegment
}

function sanitizeMessage(message, token) {
  if (!token) {
    return message
  }
  return message.split(token).join('***')
}

async function ensureDirectoryReadable(directoryPath) {
  await fs.access(directoryPath, fsConstants.R_OK | fsConstants.W_OK)
}

async function getSvgFiles(rootDirectory) {
  const svgFiles = []

  async function walk(currentDirectory) {
    const entries = await fs.readdir(currentDirectory, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        continue
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        const relativePath = path.relative(rootDirectory, fullPath)
        svgFiles.push({
          relativePath,
          fullPath
        })
      }
    }
  }

  await walk(rootDirectory)
  svgFiles.sort((left, right) => left.relativePath.localeCompare(right.relativePath))
  return svgFiles
}

async function createAskPassFile(jobId) {
  const askPassPath = path.join(os.tmpdir(), `inktrace-askpass-${jobId}.sh`)
  const scriptContent = '#!/bin/sh\necho "$GITHUB_TOKEN"\n'
  await fs.writeFile(askPassPath, scriptContent, { mode: 0o700 })
  await fs.chmod(askPassPath, 0o700)
  return askPassPath
}

async function deleteFileQuietly(filePath) {
  if (!filePath) {
    return
  }

  try {
    await fs.unlink(filePath)
  } catch {
    // Ignore cleanup errors.
  }
}

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  win.loadFile('index.html')
}

function registerIpcHandlers() {
  ipcMain.handle('dialog:pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true, folderPath: null }
    }

    return { canceled: false, folderPath: result.filePaths[0] }
  })

  ipcMain.handle('git:cloneStart', async (event, payload) => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender)
    const repoUrl = String(payload?.repoUrl || '').trim()
    const branch = String(payload?.branch || '').trim() || 'main'
    const destinationFolder = String(payload?.destinationFolder || '').trim()
    const token = String(payload?.token || '').trim()

    if (!repoUrl || !destinationFolder) {
      throw new Error('repoUrl 與 destinationFolder 為必填欄位。')
    }

    await ensureDirectoryReadable(destinationFolder)

    const repositoryName = parseRepoName(repoUrl)
    const targetDirectory = path.join(destinationFolder, repositoryName)
    const jobId = crypto.randomUUID()

    try {
      await fs.access(targetDirectory)
      throw new Error(`目標資料夾已存在：${targetDirectory}`)
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error
      }
    }

    const cloneArgs = [
      'clone',
      '--progress',
      '--branch',
      branch,
      '--single-branch',
      repoUrl,
      targetDirectory
    ]

    const env = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0'
    }

    let askPassPath = null
    if (token) {
      askPassPath = await createAskPassFile(jobId)
      env.GITHUB_TOKEN = token
      env.GIT_ASKPASS = askPassPath
      env.GIT_ASKPASS_REQUIRE = 'force'
    }

    const child = spawn('git', cloneArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    cloneJobs.set(jobId, {
      child,
      askPassPath,
      targetDirectory,
      token,
      completed: false
    })

    const emitProgress = (chunk, source) => {
      const text = sanitizeMessage(String(chunk), token)
      const lines = text
        .split(/\r?\n|\r/)
        .map((line) => line.trim())
        .filter(Boolean)

      for (const line of lines) {
        const percentMatch = line.match(/(\d{1,3})%/)
        sendCloneEvent(targetWindow, 'git:progress', {
          jobId,
          source,
          message: line,
          percent: percentMatch ? Number(percentMatch[1]) : null
        })
      }
    }

    child.stdout.on('data', (chunk) => emitProgress(chunk, 'stdout'))
    child.stderr.on('data', (chunk) => emitProgress(chunk, 'stderr'))

    child.once('error', async (spawnError) => {
      const job = cloneJobs.get(jobId)
      if (!job || job.completed) {
        return
      }

      job.completed = true
      await deleteFileQuietly(job.askPassPath)
      cloneJobs.delete(jobId)

      sendCloneEvent(targetWindow, 'git:done', {
        jobId,
        ok: false,
        message: sanitizeMessage(spawnError.message, token)
      })
    })

    child.once('close', async (code) => {
      const job = cloneJobs.get(jobId)
      if (!job || job.completed) {
        return
      }

      job.completed = true
      await deleteFileQuietly(job.askPassPath)

      if (code === 0) {
        sendCloneEvent(targetWindow, 'git:done', {
          jobId,
          ok: true,
          message: 'Clone 完成。',
          targetDirectory
        })
      } else {
        sendCloneEvent(targetWindow, 'git:done', {
          jobId,
          ok: false,
          message: `git clone 失敗（exit code: ${code ?? 'unknown'}）。`
        })
      }

      cloneJobs.delete(jobId)
    })

    return {
      ok: true,
      jobId,
      targetDirectory,
      repositoryName
    }
  })

  ipcMain.handle('git:cancelClone', async (_, payload) => {
    const jobId = String(payload?.jobId || '')
    const job = cloneJobs.get(jobId)
    if (!job) {
      return { ok: false, message: '找不到進行中的 clone 工作。' }
    }

    job.completed = true
    job.child.kill('SIGTERM')
    await deleteFileQuietly(job.askPassPath)
    cloneJobs.delete(jobId)

    return { ok: true }
  })

  ipcMain.handle('svg:list', async (_, payload) => {
    const rootDirectory = String(payload?.rootDirectory || '').trim()
    if (!rootDirectory) {
      throw new Error('rootDirectory 為必填欄位。')
    }

    const files = await getSvgFiles(rootDirectory)
    return { ok: true, files }
  })

  ipcMain.handle('svg:loadPreview', async (_, payload) => {
    const svgPath = String(payload?.svgPath || '').trim()
    if (!svgPath) {
      throw new Error('svgPath 為必填欄位。')
    }

    const content = await fs.readFile(svgPath)
    const dataUrl = `data:image/svg+xml;base64,${content.toString('base64')}`
    return {
      ok: true,
      dataUrl
    }
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})