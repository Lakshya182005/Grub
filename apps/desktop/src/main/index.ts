import { app, BrowserWindow, ipcMain, systemPreferences, shell, globalShortcut, Tray, Menu, nativeImage } from 'electron'
import { join, resolve } from 'path'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { homedir } from 'os'
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
  let current = __dirname
  while (current !== resolve(current, '..')) {
    if (existsSync(join(current, 'AGENTS.md')) || existsSync(join(current, 'docs/00-MVP-PLAN.md'))) {
      return current
    }
    current = resolve(current, '..')
  }
  return resolve(__dirname, '../../../..')
}

function getNotesFolder(): string {
  return join(homedir(), 'Documents', 'Hey Scribe')
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

function updateTrayState(state: string): void {
  if (!tray) return

  switch (state) {
    case 'listening':
      tray.setTitle(' ● listening')
      break
    case 'thinking':
      tray.setTitle(' ● thinking')
      break
    case 'speaking':
      tray.setTitle(' ● speaking')
      break
    default:
      tray.setTitle('')
      break
  }
}

function triggerDemo(file: string): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('scribe:trigger-demo', file)
  }
}

function createTray(): void {
  const iconPaths = [
    join(__dirname, 'trayTemplate.png'),
    join(__dirname, '../../resources/trayTemplate.png'),
    join(__dirname, '../../src/main/trayTemplate.png')
  ]

  let icon = nativeImage.createEmpty()
  for (const p of iconPaths) {
    if (existsSync(p)) {
      icon = nativeImage.createFromPath(p)
      icon.setTemplateImage(true)
      break
    }
  }

  tray = new Tray(icon)

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show Hey Scribe',
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
      label: 'Demo Mode',
      submenu: [
        {
          label: 'hello.wav (Design review)',
          click: (): void => triggerDemo('hello.wav')
        },
        {
          label: 'wake.wav (Wake phrase)',
          click: (): void => triggerDemo('wake.wav')
        }
      ]
    },
    {
      label: 'Open notes folder',
      click: (): void => {
        const folder = getNotesFolder()
        mkdirSync(folder, { recursive: true })
        shell.openPath(folder)
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      accelerator: 'CommandOrControl+Q',
      click: (): void => {
        isQuitting = true
        app.quit()
      }
    }
  ])

  tray.setToolTip('Hey Scribe')
  tray.setContextMenu(contextMenu)
}

function createApplicationMenu(): void {
  const isMac = process.platform === 'darwin'

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Notes Folder',
          accelerator: 'CmdOrCtrl+O',
          click: (): void => {
            const folder = getNotesFolder()
            mkdirSync(folder, { recursive: true })
            shell.openPath(folder)
          }
        },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' as const }] : [{ role: 'quit' as const }])
      ]
    },
    {
      label: 'Demo Mode',
      submenu: [
        {
          label: 'Replay hello.wav',
          accelerator: 'CmdOrCtrl+D',
          click: (): void => triggerDemo('hello.wav')
        },
        {
          label: 'Replay wake.wav',
          click: (): void => triggerDemo('wake.wav')
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }])
      ]
    }
  ]

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
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

ipcMain.handle('scribe:reveal-file', (_event, filePath: string) => {
  if (filePath) {
    shell.showItemInFolder(filePath)
  }
})

ipcMain.handle('scribe:open-notes-folder', () => {
  const folder = getNotesFolder()
  mkdirSync(folder, { recursive: true })
  shell.openPath(folder)
})

ipcMain.handle('scribe:set-state', (_event, state: string) => {
  updateTrayState(state)
})

ipcMain.handle('scribe:capture-screenshot', async (_event, name: string) => {
  if (!mainWindow) throw new Error('No window')
  const image = await mainWindow.webContents.capturePage()
  const pngBuffer = image.toPNG()
  const repoRoot = getRepoRoot()
  const screenshotDir = join(repoRoot, 'screenshots')
  mkdirSync(screenshotDir, { recursive: true })
  const filePath = join(screenshotDir, `${name}.png`)
  writeFileSync(filePath, pngBuffer)
  console.log(`[main] Screenshot saved: ${filePath}`)
  return filePath
})

ipcMain.handle('scribe:get-sidecar-info', () => {
  if (sidecarPort) {
    return { port: sidecarPort, token: sidecarToken, status: 'running' }
  }
  return { port: null, token: sidecarToken, status: 'starting' }
})

async function runScreenshotSuite(): Promise<void> {
  if (!mainWindow) return
  console.log('[acceptance] Running automated screenshot suite...')

  const repoRoot = getRepoRoot()
  const screenshotDir = join(repoRoot, 'screenshots')
  mkdirSync(screenshotDir, { recursive: true })

  const capture = async (name: string): Promise<void> => {
    if (!mainWindow) return
    const image = await mainWindow.webContents.capturePage()
    const filePath = join(screenshotDir, `${name}.png`)
    writeFileSync(filePath, image.toPNG())
    console.log(`[acceptance] Captured: ${filePath}`)
  }

  // Ensure window is 1280x820
  mainWindow.setSize(1280, 820)
  await new Promise((r) => setTimeout(r, 600))

  // 1. Idle state
  await mainWindow.webContents.executeJavaScript("window.setTestState && window.setTestState('idle')")
  await new Promise((r) => setTimeout(r, 300))
  await capture('orb-idle-1280x820')

  // 2. Listening state
  await mainWindow.webContents.executeJavaScript("window.setTestState && window.setTestState('listening')")
  await new Promise((r) => setTimeout(r, 300))
  await capture('orb-listening-1280x820')

  // 3. Thinking state
  await mainWindow.webContents.executeJavaScript(
    "window.setTestState && window.setTestState('thinking'); window.setTestTranscript && window.setTestTranscript('Design review moved to Thursday at 4, Priya is presenting.');"
  )
  await new Promise((r) => setTimeout(r, 300))
  await capture('orb-thinking-1280x820')

  // 4. Speaking state
  await mainWindow.webContents.executeJavaScript("window.setTestState && window.setTestState('speaking')")
  await new Promise((r) => setTimeout(r, 300))
  await capture('orb-speaking-1280x820')

  // 5. Two Note Cards in rail
  await mainWindow.webContents.executeJavaScript("window.setTestState && window.setTestState('idle'); window.addTestNotes && window.addTestNotes();")
  await new Promise((r) => setTimeout(r, 300))
  await capture('two-notes-1280x820')

  // 6. Test 1440x900 resolution
  mainWindow.setSize(1440, 900)
  await new Promise((r) => setTimeout(r, 400))
  await capture('two-notes-1440x900')

  console.log('[acceptance] All 6 screenshots captured successfully!')
  isQuitting = true
  app.quit()
}

app.whenReady().then(async () => {
  createApplicationMenu()
  createTray()
  createWindow()

  if (process.argv.includes('--capture-screenshots')) {
    mainWindow?.webContents.on('did-finish-load', () => {
      runScreenshotSuite().catch((err) => {
        console.error('[acceptance] Screenshot error:', err)
        app.exit(1)
      })
    })
    return
  }

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
