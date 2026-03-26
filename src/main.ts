import {
  Engine,
  Scene,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Color4,
  Color3,
  Ray,
  MeshBuilder,
  StandardMaterial,
} from '@babylonjs/core'
import { Terrain } from './terrain'
import { Player } from './player'
import { Network } from './network'
import { RemotePlayer } from './remote'
import { generateLevel } from './level'
import { Enemy } from './enemy'

const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
const network = new Network()

// ── On-screen status/error overlay ───────────────────────────────────────────
function showStatus(msg: string, isError = false): void {
  let el = document.getElementById('_gameStatus')
  if (!el) {
    el = document.createElement('div')
    el.id = '_gameStatus'
    el.style.cssText = [
      'position:fixed', 'top:50%', 'left:50%',
      'transform:translate(-50%,-50%)',
      'background:rgba(0,10,40,0.93)',
      'padding:1.2rem 2rem',
      'font:0.95rem/1.5 system-ui,sans-serif',
      'z-index:999', 'border-radius:10px',
      'max-width:80%', 'text-align:center',
      'white-space:pre-wrap', 'border:1px solid #446',
    ].join(';')
    document.body.appendChild(el)
  }
  el.style.color = isError ? '#f88' : '#cdf'
  el.textContent = msg
}
function hideStatus(): void {
  document.getElementById('_gameStatus')?.remove()
}

async function startGame() {
  showStatus('Starting engine…')

  // Test WebGL availability on a FRESH canvas BEFORE Babylon touches anything.
  // Babylon's failed constructor attempts can taint the page canvas.
  const testCanvas = document.createElement('canvas')
  testCanvas.width = 100; testCanvas.height = 100
  const testCtx = testCanvas.getContext('webgl2') ?? testCanvas.getContext('webgl')
  if (!testCtx) {
    showStatus(
      `Your browser is blocking WebGL.\n\nUA: ${navigator.userAgent.slice(0, 120)}\n\nFix: In Chrome go to:\n  Settings → System → "Use hardware acceleration when available" → ON\n  Then restart Chrome.`,
      true,
    )
    return
  }
  console.log('Fresh canvas WebGL OK:', testCtx.constructor.name)

  // Try WebGL2, fall back to WebGL1
  let engine: Engine | undefined
  let lastErr: unknown
  for (const noWebGL2 of [false, true]) {
    try {
      engine = new Engine(canvas, true, {
        preserveDrawingBuffer: true,
        stencil: true,
        disableWebGL2Support: noWebGL2,
      })
      break
    } catch (e) {
      lastErr = e
    }
  }

  if (!engine) {
    const errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr)
    showStatus(
      `Babylon engine failed (WebGL works, but Babylon threw).\n\nError: ${errMsg}\n\nUA: ${navigator.userAgent.slice(0, 120)}`,
      true,
    )
    return
  }

  const scene = new Scene(engine)
  scene.clearColor = new Color4(0.55, 0.78, 0.96, 1.0)

  scene.fogMode = Scene.FOGMODE_EXP2
  scene.fogColor = new Color3(0.55, 0.78, 0.96)
  scene.fogDensity = 0.015

  const hemi = new HemisphericLight('hemi', new Vector3(0, 1, 0), scene)
  hemi.intensity = 0.6
  const sun = new DirectionalLight('sun', new Vector3(-1, -2, -1), scene)
  sun.intensity = 0.9
  sun.position = new Vector3(60, 80, 60)

  // ── Terrain ───────────────────────────────────────────────────────────────
  showStatus('Building terrain…')
  let terrain: Terrain | null = null
  try {
    terrain = new Terrain(scene)

    const bedrock = MeshBuilder.CreateGround('bedrock', { width: 1000, height: 1000 }, scene)
    bedrock.position.y = -30.5
    const bedrockMat = new StandardMaterial('bedrockMat', scene)
    bedrockMat.diffuseColor = new Color3(0.30, 0.20, 0.12)
    bedrockMat.specularColor = new Color3(0, 0, 0)
    bedrock.material = bedrockMat
    console.log('Terrain created OK')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    showStatus(`Terrain error:\n${msg}`, true)
    console.error('Terrain error:', err)
  }

  // ── Player ────────────────────────────────────────────────────────────────
  let player: Player | null = null
  if (terrain) {
    try {
      player = new Player(scene, terrain)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`Player error:\n${msg}`, true)
      console.error('Player error:', err)
    }
  }

  // ── Remote player ─────────────────────────────────────────────────────────
  const remote = new RemotePlayer(scene)
  network.ensureSignaling()

  // ── HUD elements ──────────────────────────────────────────────────────────
  const roundHud = document.getElementById('roundHud')!
  const roundMsg = document.getElementById('roundMsg')!

  function updateRoundHud(round: number) {
    roundHud.textContent = `Round ${round}`
  }

  function flashMessage(msg: string, duration = 2000, color = '#ffe066') {
    roundMsg.textContent = msg
    roundMsg.style.color = color
    roundMsg.style.display = 'block'
    setTimeout(() => { roundMsg.style.display = 'none' }, duration)
  }

  // ── Round / Level state ───────────────────────────────────────────────────
  let currentRound = 1
  let enemies: Enemy[] = []
  let roundActive = false
  let lastRoundStartMs = 0

  function startRound(round: number) {
    // Debounce — prevent double-triggers when both players detect the same event
    const now = Date.now()
    if (now - lastRoundStartMs < 2000) return
    lastRoundStartMs = now

    currentRound = round
    updateRoundHud(round)

    // Reset terrain
    if (terrain) terrain.reset()

    // Dispose old enemies
    for (const e of enemies) e.dispose()
    enemies = []

    // Generate level (use enemy spawn positions; flag position ignored)
    const level = generateLevel(round, terrain!.worldMinX, terrain!.worldMaxX, terrain!.worldMinZ, terrain!.worldMaxZ)

    // Spawn enemies
    for (const sp of level.enemySpawns) {
      enemies.push(new Enemy(scene, terrain!, sp.x, sp.z, sp.type))
    }

    // Reset player position
    if (player) {
      const spawnY = terrain!.getSurfaceY(level.playerSpawnX, level.playerSpawnZ) + 2
      player.resetPosition(level.playerSpawnX, spawnY, level.playerSpawnZ)
    }

    roundActive = true

    // Host sends round to joiner so they spawn enemies too
    if (network.isConnected()) {
      network.sendRound(round)
    }
  }

// Start round 1 (host or solo — joiner waits for host's round message)
  if (terrain && player && (network.isHost || !network.isConnected())) {
    hideStatus()
    lastRoundStartMs = 0 // allow first startRound
    startRound(1)
  } else if (terrain && player) {
    hideStatus()
  }

  // ── Network send timer ────────────────────────────────────────────────────
  const SEND_INTERVAL = 1 / 20
  let sendTimer = 0

  // ── Input ─────────────────────────────────────────────────────────────────
  let digging = false
  canvas.addEventListener('mousedown', (e) => { if (e.button === 2) digging = true })
  canvas.addEventListener('mouseup',   (e) => { if (e.button === 2) digging = false })
  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  let digCooldown = 0
  const DIG_INTERVAL = 0.05

  // ── Render loop ───────────────────────────────────────────────────────────
  engine.runRenderLoop(() => {
    try {
      const dt = Math.min(engine!.getDeltaTime() / 1000, 0.05)

      if (player && terrain) {
        player.update(dt)

        // ── Send position to remote ────────────────────────────────────────
        sendTimer += dt
        if (sendTimer >= SEND_INTERVAL && network.isConnected()) {
          sendTimer = 0
          network.sendPosition(player.getState())
        }

        // ── Digging ────────────────────────────────────────────────────────
        if (digging) {
          digCooldown -= dt
          if (digCooldown <= 0) {
            digCooldown = DIG_INTERVAL
            const { origin, dir } = player.getCameraRay()
            const ray = new Ray(origin, dir, 20)
            const hit = scene.pickWithRay(ray, (m: any) => m.name.startsWith('chunk_'))
            if (hit?.hit && hit.pickedPoint) {
              const pt = hit.pickedPoint
              const normal = hit.getNormal(true)
              if (normal) pt.addInPlace(normal.scale(-0.3))
              terrain.dig(pt.x, pt.y, pt.z)
              network.sendDig({ x: pt.x, y: pt.y, z: pt.z })
            }
          }
        } else {
          digCooldown = 0
        }

        // ── Enemy AI ───────────────────────────────────────────────────────
        if (roundActive) {
          const remoteVec = network.lastRemoteState
            ? new Vector3(network.lastRemoteState.x, network.lastRemoteState.y, network.lastRemoteState.z)
            : null
          for (const enemy of enemies) {
            enemy.update(dt, player.position, remoteVec)
          }
        }
      }

      // ── Receive remote player state ──────────────────────────────────────
      if (network.lastRemoteState) {
        remote.updateTarget(network.lastRemoteState)
      }
      remote.update(dt)

      // ── Apply remote dig events ──────────────────────────────────────────
      if (terrain && network.pendingDigs.length > 0) {
        for (const dig of network.pendingDigs) {
          terrain.dig(dig.x, dig.y, dig.z)
        }
        network.pendingDigs.length = 0
      }

      // ── Handle remote round sync ─────────────────────────────────────────
      if (network.pendingRound !== null) {
        startRound(network.pendingRound)
        network.pendingRound = null
      }
      if (network.pendingCaught) {
        network.pendingCaught = false
      }
    } catch (err) {
      console.error('Render loop error:', err)
    }

    scene.render()
  })

  window.addEventListener('resize', () => engine!.resize())
}

// Start only after a user gesture (button click)
const playBtn   = document.getElementById('playBtn')!
const hostBtn   = document.getElementById('hostBtn')!
const joinBtn   = document.getElementById('joinBtn')!
const joinInput = document.getElementById('joinInput') as HTMLInputElement
const lobbyEl   = document.getElementById('lobby')!
const lobbyMsg  = document.getElementById('lobbyMsg')!

// Solo play — no networking
playBtn.addEventListener('click', () => {
  lobbyEl.style.display = 'none'
  startGame().catch(err => {
    const msg = err instanceof Error ? err.message : String(err)
    showStatus(`Startup failed:\n${msg}`, true)
    console.error('startGame failed:', err)
  })
})

// Host a room
hostBtn.addEventListener('click', () => {
  hostBtn.style.display = 'none'
  joinBtn.style.display = 'none'
  joinInput.style.display = 'none'
  playBtn.style.display = 'none'
  lobbyMsg.textContent = 'Connecting to signaling server…'

  network.onError = (msg) => { lobbyMsg.textContent = msg; lobbyMsg.style.color = '#f88' }

  network.host((roomId) => {
    lobbyMsg.innerHTML = `Room code: <b style="color:#6f6;font-size:1.3rem;letter-spacing:0.08em">${roomId}</b><br><br>Share this code with a friend — waiting for them to join…`
  })

  network.onPeerConnected = () => {
    lobbyEl.style.display = 'none'
    startGame().catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`Startup failed:\n${msg}`, true)
    })
  }
})

// Join a room
joinBtn.addEventListener('click', () => {
  const code = joinInput.value.trim()
  if (!code) { joinInput.focus(); return }

  hostBtn.style.display = 'none'
  joinBtn.style.display = 'none'
  joinInput.style.display = 'none'
  playBtn.style.display = 'none'
  lobbyMsg.textContent = `Joining room "${code}"…`

  network.onError = (msg) => { lobbyMsg.textContent = msg; lobbyMsg.style.color = '#f88' }

  network.join(code, () => {
    lobbyEl.style.display = 'none'
    startGame().catch(err => {
      const msg = err instanceof Error ? err.message : String(err)
      showStatus(`Startup failed:\n${msg}`, true)
    })
  })
})
