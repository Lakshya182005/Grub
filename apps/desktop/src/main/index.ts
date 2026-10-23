import { app, BrowserWindow, ipcMain, systemPreferences, shell, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { existsSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'

let mainWindow: BrowserWindow | null = null
let sidecarProcess: ChildProcess | null = null
let sidecarPort: number | null = null
let sidecarToken: string = randomUUID()
let sidecarRestartCount = 0
let isQuitting = false
let tray: Tray | null = null
let isPttActive = false

function getRepoRoot(): string {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return resolve(__dirname, '../../..')
}

async function getMicrophoneStatus(): Promise<string> {
  if (process.platform === 'darwin') {
    let status = systemPreferences.getMediaAccessStatus('microphone')
    if (status === 'not-determined') {
      const granted = await systemPreferences.askForMediaAccess('microphone')
      status = granted ? 'granted' : 'denied'
    }
    return status
  }
  return 'granted'
}

function spawnSidecar(): void {
  if (isQuitting) return

  const repoRoot = getRepoRoot()
  sidecarToken = randomUUID()

  console.log(`[main] Spawning sidecar in ${repoRoot} with token...`)

  const child = spawn(
    'uv',
    ['run', '--project', 'sidecar', 'python', '-m', 'app.main', '--port', '0', '--token', sidecarToken],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONPATH: join(repoRoot, 'sidecar'),
        SIDECAR_TOKEN: sidecarToken
      },
      stdio: ['ignore', 'pipe', 'inherit']
    }
  )

  sidecarProcess = child

  let stdoutBuffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf-8')
    const lines = stdoutBuffer.split('\n')
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.startsWith('READY')) {
        try {
          const jsonStr = trimmed.slice(5).trim()
          const data = JSON.parse(jsonStr)
          if (data && typeof data.port === 'number') {
            sidecarPort = data.port
            console.log(`[main] Sidecar ready on port ${sidecarPort}`)
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('scribe:sidecar-ready', {
                port: sidecarPort,
                token: sidecarToken
              })
              mainWindow.webContents.send('scribe:sidecar-status', { status: 'running' })
            }
          }
        } catch (err) {
          console.error('[main] Failed to parse sidecar READY line:', line, err)
        }
      }
    }
  })

  child.on('exit', (code, signal) => {
    console.log(`[main] Sidecar exited (code: ${code}, signal: ${signal})`)
    sidecarProcess = null
    sidecarPort = null

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scribe:sidecar-status', {
        status: 'crashed',
        code: code ?? signal
      })
    }

    if (!isQuitting && sidecarRestartCount < 1) {
      sidecarRestartCount += 1
      console.log('[main] Restarting sidecar once in 2 seconds...')
      setTimeout(() => {
        spawnSidecar()
      }, 2000)
    }
  })
}

function createTray(): void {
  // Create simple 16x16 icon
  const icon = nativeImage.createEmpty()
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show window',
      click: (): void => {
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore()
          mainWindow.show()
          mainWindow.focus()
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: (): void => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('Hey Scribe')
  tray.setContextMenu(contextMenu)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0b0e14',
    webPreferences: {
      preload: existsSync(join(__dirname, '../preload/index.mjs'))
        ? join(__dirname, '../preload/index.mjs')
        : join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Deny all navigation & new windows
  mainWindow.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })

  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // Load renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// IPC Handlers
ipcMain.handle('scribe:get-mic-status', async () => {
  return await getMicrophoneStatus()
})

ipcMain.handle('scribe:open-mic-settings', () => {
  shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone')
})

ipcMain.handle('scribe:get-sidecar-info', () => {
  if (sidecarPort) {
    return { port: sidecarPort, token: sidecarToken, status: 'running' }
  }
  return { port: null, token: sidecarToken, status: 'starting' }
})

app.whenReady().then(async () => {
  createTray()
  createWindow()
  spawnSidecar()

  // Register Alt+Space global shortcut for PTT toggle
  globalShortcut.register('Alt+Space', () => {
    isPttActive = !isPttActive
    console.log(`[main] Alt+Space shortcut triggered, PTT active = ${isPttActive}`)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scribe:ptt-change', { on: isPttActive })
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  if (sidecarProcess && !sidecarProcess.killed) {
    sidecarProcess.kill('SIGTERM')
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (sidecarProcess && !sidecarProcess.killed) {
    sidecarProcess.kill('SIGTERM')
  }
})
