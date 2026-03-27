import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  ArcRotateCamera,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
} from '@babylonjs/core'
import type { Terrain } from './terrain'
import type { AnimState, PlayerState } from './types'

// ── Movement constants ───────────────────────────────────────────────────────
const GRAVITY       = -28
const JUMP_VELOCITY = 14
const MOVE_SPEED    = 8
const PLAYER_HEIGHT  = 1.2
const PLAYER_RADIUS  = 0.4
const TERMINAL_VEL   = -30
const STEP_HEIGHT    = 2.0    // max terrain rise the player can walk up
const GROUND_SNAP    = 0.05   // tiny offset above surface when grounded
const FALL_THRESHOLD = 3.0    // surface must drop more than this to trigger falling
const ANT_SCALE      = 2.16

// ── Camera constants ─────────────────────────────────────────────────────────
const CAM_DEFAULT_RADIUS = 14
const CAM_MIN_RADIUS     = 2     // close enough to see dog head at screen bottom
const CAM_LERP_SPEED     = 12   // how fast the radius adjusts (units/sec)

const SPAWN = new Vector3(0, 4, 0)

const ANT_ANIM_FILES: Record<AnimState, string> = {
  idle: './assets/ant/idle.glb',
  walk: './assets/ant/walk.glb',
  jump: './assets/ant/jump.glb',
  fall: './assets/ant/fall.glb',
}

interface AnimEntry {
  root: TransformNode
  yOffset: number
  group: AnimationGroup | null
}

function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const worldMin = m.getBoundingInfo().boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

export class Player {
  private scene: Scene
  private terrain: Terrain

  /** feet position in world space */
  position = SPAWN.clone()
  private velocity = Vector3.Zero()
  private onGround = false

  camera!: ArcRotateCamera
  /** The direction the player model faces (radians, Y axis) */
  facingY = 0
  /** The desired camera radius (before terrain collision) */
  private desiredRadius = CAM_DEFAULT_RADIUS

  // Input state
  private keys = new Set<string>()

  // Model
  private modelRoot: TransformNode | null = null
  private anims = new Map<AnimState, AnimEntry>()
  private currentAnim: AnimState = 'idle'
  private animsLoaded = false

  // Camera mode: 1=dynamic radius, 2=fixed orbit, 3=first-person, 4=experimental adjustable
  private cameraMode: 1 | 2 | 3 | 4 = 1

  // Mode 4 adjustable offsets
  private cam4Radius = 14
  private cam4OffsetX = 0
  private cam4OffsetY = 0
  private cam4BetaOffset = 0
  private cam4InfoEl: HTMLElement | null = null
  private arrowMesh: Mesh | null = null

  constructor(scene: Scene, terrain: Terrain) {
    this.scene = scene
    this.terrain = terrain
    this.cam4InfoEl = document.getElementById('cam4Info')
    this.setupCamera()
    this.setupInput()
    this.loadModel()
    this.createArrow()
  }

  private createArrow(): void {
    // Shaft (cylinder rotated to point along +Z)
    const shaft = MeshBuilder.CreateCylinder('arrowShaft', {
      height: 1.8,
      diameter: 0.18,
      tessellation: 8,
    }, this.scene)
    shaft.rotation.x = Math.PI / 2
    shaft.position.z = 0.9

    // Head (cone)
    const head = MeshBuilder.CreateCylinder('arrowHead', {
      height: 0.6,
      diameterTop: 0,
      diameterBottom: 0.5,
      tessellation: 8,
    }, this.scene)
    head.rotation.x = Math.PI / 2
    head.position.z = 2.1

    // Merge into one mesh
    const arrow = Mesh.MergeMeshes([shaft, head], true, true, undefined, false, true)!
    arrow.name = 'facingArrow'

    const mat = new StandardMaterial('arrowMat', this.scene)
    mat.diffuseColor = new Color3(1, 0.15, 0.1)
    mat.emissiveColor = new Color3(0.6, 0.05, 0.03)
    mat.disableLighting = true
    mat.disableDepthWrite = true
    arrow.material = mat
    arrow.isPickable = false
    arrow.renderingGroupId = 1

    this.arrowMesh = arrow
  }

  // ── Camera ───────────────────────────────────────────────────────────────────
  private setupCamera(): void {
    // ArcRotateCamera orbits the player — uses LEFT mouse drag to rotate (no pointer lock needed)
    const cam = new ArcRotateCamera('cam', -Math.PI / 2, 1.0, CAM_DEFAULT_RADIUS, SPAWN.clone(), this.scene)
    cam.lowerRadiusLimit = CAM_MIN_RADIUS
    cam.upperRadiusLimit = 28
    cam.lowerBetaLimit = 0.15            // nearly straight up
    cam.upperBetaLimit = Math.PI * 0.85  // nearly straight down

    // Disable panning (middle mouse) and keyboard
    cam.panningSensibility = 0
    cam.inputs.removeByType('ArcRotateCameraKeyboardMoveInput')
    // Pointer-lock handles rotation manually — remove the default drag handler
    cam.inputs.removeByType('ArcRotateCameraPointersInput')

    const canvas = this.scene.getEngine().getRenderingCanvas()!
    cam.attachControl(canvas, true)
    this.camera = cam

    // Click canvas to capture pointer; mouse movement rotates camera
    canvas.addEventListener('click', () => {
      canvas.requestPointerLock()
    })
    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return
      const sens = 0.004
      cam.alpha -= e.movementX * sens
      cam.beta  -= e.movementY * sens
      const bLo = cam.lowerBetaLimit ?? 0.15
      const bHi = cam.upperBetaLimit ?? Math.PI * 0.85
      if (cam.beta < bLo) cam.beta = bLo
      if (cam.beta > bHi) cam.beta = bHi
    })
  }

  private setCameraMode(m: 1 | 2 | 3 | 4): void {
    if (m === this.cameraMode) return
    // Hide mode-4 overlay when leaving
    if (this.cam4InfoEl) this.cam4InfoEl.style.display = 'none'
    this.cameraMode = m
    const cam = this.camera
    if (m === 3) {
      cam.lowerBetaLimit = 0.05
      cam.upperBetaLimit = Math.PI * 0.95
      cam.upperRadiusLimit = null  // allow large radius for FPS trick
    } else if (m === 4) {
      // Reset offsets on entry
      this.cam4Radius = 14
      this.cam4OffsetX = 0
      this.cam4OffsetY = 0
      this.cam4BetaOffset = 0
      cam.lowerBetaLimit = 0.15
      cam.upperBetaLimit = Math.PI * 0.85
      cam.upperRadiusLimit = 60
      cam.radius = this.cam4Radius
      if (this.cam4InfoEl) this.cam4InfoEl.style.display = 'block'
    } else {
      cam.lowerBetaLimit = 0.15
      cam.upperBetaLimit = Math.PI * 0.85
      cam.upperRadiusLimit = 28
      cam.radius = this.desiredRadius
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────────
  private setupInput(): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase())
      if (e.key === '1') this.setCameraMode(1)
      if (e.key === '2') this.setCameraMode(2)
      if (e.key === '3') this.setCameraMode(3)
      if (e.key === '4') this.setCameraMode(4)
    })

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.key.toLowerCase())
    })
  }

  // ── Model ────────────────────────────────────────────────────────────────────
  private async loadModel(): Promise<void> {
    // Create a common root that follows the player position
    this.modelRoot = new TransformNode('antRoot', this.scene)

    for (const [anim, file] of Object.entries(ANT_ANIM_FILES) as [AnimState, string][]) {
      try {
        const result = await SceneLoader.ImportMeshAsync('', '', file, this.scene)
        const root = new TransformNode(`ant_${anim}`, this.scene)
        root.parent = this.modelRoot

        const meshes = result.meshes.filter((m: AbstractMesh): m is Mesh => m !== result.meshes[0])
        const bottomY = meshBottomY(meshes)

        for (const m of meshes) {
          m.parent = root
        }
        // Clean up the __root__ node
        result.meshes[0].dispose()

        root.scaling.setAll(ANT_SCALE)
        root.setEnabled(false)

        const group = result.animationGroups[0] ?? null
        if (group) {
          group.stop()
          const noLoop = anim === 'jump'
          group.loopAnimation = !noLoop
        }

        this.anims.set(anim, { root, yOffset: bottomY * ANT_SCALE, group })
      } catch (err) {
        console.warn(`Failed to load ant anim: ${anim}`, err)
      }
    }

    this.animsLoaded = true
    this.playAnim('idle')
  }

  private playAnim(a: AnimState): void {
    if (a === this.currentAnim || !this.animsLoaded) return
    const prev = this.anims.get(this.currentAnim)
    if (prev) {
      prev.root.setEnabled(false)
      prev.group?.stop()
    }
    const next = this.anims.get(a)
    if (next) {
      next.root.setEnabled(true)
      next.group?.start(next.group.loopAnimation, 1.0, next.group.from, next.group.to, false)
    }
    this.currentAnim = a
  }

  // ── Update (call each frame) ─────────────────────────────────────────────────
  update(dt: number): void {
    // ── Horizontal movement (camera-relative) ──────────────────────────────
    let moveX = 0
    let moveZ = 0
    if (this.keys.has('w') || this.keys.has('arrowup'))    moveZ += 1
    if (this.keys.has('s') || this.keys.has('arrowdown'))  moveZ -= 1
    if (this.keys.has('a') || this.keys.has('arrowleft'))  moveX -= 1
    if (this.keys.has('d') || this.keys.has('arrowright')) moveX += 1

    // ── Mode 4 camera adjustments ───────────────────────────────────────
    if (this.cameraMode === 4) {
      const zoomSpeed = 12
      const panSpeed = 8
      if (this.keys.has(',') || this.keys.has('<')) this.cam4Radius = Math.max(1, this.cam4Radius - zoomSpeed * dt)
      if (this.keys.has('.') || this.keys.has('>')) this.cam4Radius = Math.min(60, this.cam4Radius + zoomSpeed * dt)
      if (this.keys.has('j')) this.cam4OffsetX -= panSpeed * dt
      if (this.keys.has('l')) this.cam4OffsetX += panSpeed * dt
      if (this.keys.has('i')) this.cam4OffsetY += panSpeed * dt
      if (this.keys.has('k')) this.cam4OffsetY -= panSpeed * dt
      const rotSpeed = 1.5
      if (this.keys.has('o')) this.cam4BetaOffset -= rotSpeed * dt
      if (this.keys.has('p')) this.cam4BetaOffset += rotSpeed * dt
    }

    // ── Camera-derived directions ──────────────────────────────────────────
    let forward: Vector3, right: Vector3
    if (this.cameraMode === 3) {
      // FPS: derive facing from camera spherical angles
      // camera position = target + R*(sinβ*cosα, cosβ, sinβ*sinα)
      // so look direction = -spherical = (-sinβ*cosα, -cosβ, -sinβ*sinα)
      const sb = Math.sin(this.camera.beta)
      const ca = Math.cos(this.camera.alpha)
      const sa = Math.sin(this.camera.alpha)
      this.facingY = Math.atan2(-sb * ca, -sb * sa)
      forward = new Vector3(Math.sin(this.facingY), 0, Math.cos(this.facingY))
    } else {
      // Modes 1 & 2: facing = horizontal direction from camera toward player
      const camToPlayer = this.camera.target.subtract(this.camera.position)
      forward = new Vector3(camToPlayer.x, 0, camToPlayer.z).normalize()
      this.facingY = Math.atan2(forward.x, forward.z)
    }
    right = new Vector3(forward.z, 0, -forward.x) // 90° CW in XZ

    const moveDir = forward.scale(moveZ).add(right.scale(moveX))
    if (moveDir.length() > 0.01) {
      moveDir.normalize()
    }

    const speed = MOVE_SPEED
    this.velocity.x = moveDir.x * speed
    this.velocity.z = moveDir.z * speed

    // ── Jump ───────────────────────────────────────────────────────────────
    if ((this.keys.has(' ') || this.keys.has('e')) && this.onGround) {
      this.velocity.y = JUMP_VELOCITY
      this.onGround = false
    }

    if (this.onGround) {
      // ── GROUNDED: surface-following movement ────────────────────────────
      // Only search from feet + STEP_HEIGHT so the scan stays inside tunnels
      // instead of poking above the ceiling and finding the outdoor surface.
      let searchFromY = this.position.y + STEP_HEIGHT
      if (this.terrain.isSolid(this.position.x, searchFromY, this.position.z)) {
        searchFromY = this.position.y + 0.5
      }
      const chestY = this.position.y + PLAYER_HEIGHT * 0.7

      // Try X movement (allows wall-sliding when blocked diagonally)
      let newX = this.position.x
      const tryX = this.position.x + this.velocity.x * dt
      if (!this.terrain.isSolid(tryX, chestY, this.position.z)) {
        const surf = this.terrain.getSurfaceYBelow(tryX, this.position.z, searchFromY)
        if (surf - this.position.y <= STEP_HEIGHT) newX = tryX
      }

      // Try Z movement
      let newZ = this.position.z
      const tryZ = this.position.z + this.velocity.z * dt
      if (!this.terrain.isSolid(newX, chestY, tryZ)) {
        const surf = this.terrain.getSurfaceYBelow(newX, tryZ, searchFromY)
        if (surf - this.position.y <= STEP_HEIGHT) newZ = tryZ
      }

      this.position.x = newX
      this.position.z = newZ

      // Snap to surface at the new position
      const destSurfY = this.terrain.getSurfaceYBelow(newX, newZ, searchFromY)
      if (this.position.y - destSurfY > FALL_THRESHOLD) {
        // Ground fell away (dug out or cliff edge) — start falling
        this.onGround = false
        this.velocity.y = 0
      } else {
        this.position.y = destSurfY + GROUND_SNAP
      }

    } else {
      // ── AIRBORNE: gravity-based physics ─────────────────────────────────
      this.velocity.y += GRAVITY * dt
      if (this.velocity.y < TERMINAL_VEL) this.velocity.y = TERMINAL_VEL
      this.position.y += this.velocity.y * dt

      // Horizontal movement with wall collision
      const newX = this.position.x + this.velocity.x * dt
      if (!this.terrain.isSolid(newX, this.position.y + PLAYER_HEIGHT * 0.5, this.position.z)) {
        this.position.x = newX
      } else {
        this.velocity.x = 0
      }
      const newZ = this.position.z + this.velocity.z * dt
      if (!this.terrain.isSolid(this.position.x, this.position.y + PLAYER_HEIGHT * 0.5, newZ)) {
        this.position.z = newZ
      } else {
        this.velocity.z = 0
      }

      // Landing check — scan from FEET level downward, not from head,
      // so tunnel ceilings above aren't mistaken for the floor below.
      const surfBelow = this.terrain.getSurfaceYBelow(
        this.position.x, this.position.z,
        this.position.y + 0.5,
      )
      if (this.position.y <= surfBelow + GROUND_SNAP && this.velocity.y <= 0) {
        this.position.y = surfBelow + GROUND_SNAP
        this.velocity.y = 0
        this.onGround = true
      }

      // Ceiling check
      if (this.velocity.y > 0 && this.terrain.isSolid(
        this.position.x, this.position.y + PLAYER_HEIGHT, this.position.z,
      )) {
        this.velocity.y = 0
      }
    }

    // ── World floor safety net ──────────────────────────────────────────────
    if (this.position.y < -35) {
      const safeSurf = this.terrain.getSurfaceY(this.position.x, this.position.z)
      if (safeSurf > -28) {
        this.position.y = safeSurf + 1
      } else {
        this.position.set(0, this.terrain.getSurfaceY(0, 0) + 2, 0)
      }
      this.velocity.setAll(0)
      this.onGround = true
    }

    // Clamp to world horizontal bounds so the player can't walk off the edge
    const margin = 0.5
    this.position.x = Math.max(this.terrain.worldMinX + margin, Math.min(this.terrain.worldMaxX - margin, this.position.x))
    this.position.z = Math.max(this.terrain.worldMinZ + margin, Math.min(this.terrain.worldMaxZ - margin, this.position.z))

    // ── Animation state ────────────────────────────────────────────────────
    const moving = Math.abs(moveDir.x) > 0.1 || Math.abs(moveDir.z) > 0.1
    if (!this.onGround) {
      this.playAnim(this.velocity.y > 0 ? 'jump' : 'fall')
    } else if (moving) {
      this.playAnim('walk')
    } else {
      this.playAnim('idle')
    }

    // ── Sync model to position ─────────────────────────────────────────────
    if (this.modelRoot) {
      // Hide model in FPS mode so you don't see your own ant
      this.modelRoot.setEnabled(this.cameraMode !== 3)
      this.modelRoot.position.x = this.position.x
      this.modelRoot.position.z = this.position.z
      const entry = this.anims.get(this.currentAnim)
      const yOff = entry ? entry.yOffset : 0
      this.modelRoot.position.y = this.position.y - yOff
      this.modelRoot.rotation.y = this.facingY
    }

    // ── Facing arrow ────────────────────────────────────────────────────────
    if (this.arrowMesh) {
      this.arrowMesh.setEnabled(this.cameraMode === 4)
      if (this.cameraMode === 4) {
        this.arrowMesh.position.set(
          this.position.x,
          this.position.y + PLAYER_HEIGHT + 0.8,
          this.position.z,
        )
        // Compute dig pitch from camera direction
        const cam = this.camera
        const digDir = cam.target.subtract(cam.position).normalize()
        const pitch = Math.asin(Math.max(-1, Math.min(1, digDir.y)))
        this.arrowMesh.rotation.y = this.facingY
        this.arrowMesh.rotation.x = -pitch
      }
    }

    // ── Camera update ───────────────────────────────────────────────────
    if (this.cameraMode === 3) {
      // FPS: camera sits FPS_BACK units behind the eye to avoid terrain clipping on slopes.
      // camera.position = target + R * spherical
      // We want camera at: eye + FPS_BACK * spherical (i.e. slightly behind the head)
      // So: target = eye + FPS_BACK * spherical - FPS_R * spherical
      //             = eye - (FPS_R - FPS_BACK) * spherical
      const FPS_R    = 200
      const FPS_BACK = 1.5
      const cam  = this.camera
      const eyeY = this.position.y + PLAYER_HEIGHT * 0.85
      const sb = Math.sin(cam.beta),  cb = Math.cos(cam.beta)
      const sa = Math.sin(cam.alpha), ca = Math.cos(cam.alpha)
      const eff = FPS_R - FPS_BACK
      cam.target.set(
        this.position.x - eff * sb * ca,
        eyeY            - eff * cb,
        this.position.z - eff * sb * sa,
      )
      cam.radius = FPS_R
    } else {
      // Raise the target when the camera is pulled in close so we look over the fox
      const closeness = 1 - Math.max(0, Math.min(1, (this.camera.radius - CAM_MIN_RADIUS) / (CAM_DEFAULT_RADIUS - CAM_MIN_RADIUS)))
      const headY = this.position.y + PLAYER_HEIGHT * 0.8 + closeness * 1.5
      this.camera.target.set(this.position.x, headY, this.position.z)

      if (this.cameraMode === 1) {
        // ── Mode 1: dynamic radius — pull in when terrain clips camera ──────
        this.adjustCameraRadius(dt)
      } else if (this.cameraMode === 4) {
        // ── Mode 4: experimental adjustable camera ─────────────────────────
        this.camera.radius = this.cam4Radius
        this.camera.target.x += this.cam4OffsetX
        this.camera.target.y += this.cam4OffsetY
        this.camera.beta += this.cam4BetaOffset
        const bLo = this.camera.lowerBetaLimit ?? 0.15
        const bHi = this.camera.upperBetaLimit ?? Math.PI * 0.85
        if (this.camera.beta < bLo) this.camera.beta = bLo
        if (this.camera.beta > bHi) this.camera.beta = bHi
        if (this.cam4InfoEl) {
          this.cam4InfoEl.textContent =
            `CAM4  radius:  ${this.cam4Radius.toFixed(2)}\n` +
            `      offX:    ${this.cam4OffsetX.toFixed(2)}\n` +
            `      offY:    ${this.cam4OffsetY.toFixed(2)}\n` +
            `      betaOff: ${this.cam4BetaOffset.toFixed(2)}`
        }
      } else {
        // ── Mode 2: fixed orbit — ignore terrain, stay at desired radius ───
        this.camera.radius = this.desiredRadius
      }
    }
  }

  /**
   * Pull the camera closer when its computed position would be inside terrain.
   * Binary-search along the target→camera ray for the furthest clear radius.
   */
  private adjustCameraRadius(dt: number): void {
    const cam = this.camera
    const target = cam.target

    // Compute the direction from target to where the camera *would* be at full radius
    const dirFromTarget = cam.position.subtract(target).normalize()

    // Find the largest radius (up to desiredRadius) where the camera is NOT underground
    let safeRadius = CAM_MIN_RADIUS
    const steps = 8
    for (let i = steps; i >= 0; i--) {
      const r = CAM_MIN_RADIUS + (this.desiredRadius - CAM_MIN_RADIUS) * (i / steps)
      const probe = target.add(dirFromTarget.scale(r))
      if (!this.terrain.isSolid(probe.x, probe.y, probe.z)) {
        safeRadius = r
        break
      }
    }

    // Smoothly lerp toward the safe radius (pull in fast, restore gradually)
    const diff = safeRadius - cam.radius
    if (diff < 0) {
      // Pulling in — snap quickly so we don't clip through terrain
      cam.radius += diff * Math.min(1, CAM_LERP_SPEED * 2 * dt)
    } else {
      // Restoring — ease back gently
      cam.radius += diff * Math.min(1, CAM_LERP_SPEED * 0.5 * dt)
    }

    // Clamp
    if (cam.radius < CAM_MIN_RADIUS) cam.radius = CAM_MIN_RADIUS
    if (cam.radius > this.desiredRadius) cam.radius = this.desiredRadius
  }

  /** Get current position (for external use) */
  getPosition(): Vector3 {
    return this.position.clone()
  }

  /**
   * Get the camera origin and look direction for raycasting (e.g. digging).
   * Works correctly for all four camera modes.
   */
  getCameraRay(): { origin: Vector3; dir: Vector3 } {
    const cam = this.camera
    if (this.cameraMode === 3) {
      // FPS: camera is at eye pos, looks in -spherical direction
      const sb = Math.sin(cam.beta),  cb = Math.cos(cam.beta)
      const sa = Math.sin(cam.alpha), ca = Math.cos(cam.alpha)
      return {
        origin: cam.position.clone(),
        dir:    new Vector3(-sb * ca, -cb, -sb * sa),
      }
    }
    if (this.cameraMode === 4) {
      // Mode 4: ray from player eye toward crosshair direction so dig works at any zoom
      const eyePos = new Vector3(this.position.x, this.position.y + PLAYER_HEIGHT * 0.85, this.position.z)
      const dir = cam.target.subtract(cam.position).normalize()
      return { origin: eyePos, dir }
    }
    return {
      origin: cam.position.clone(),
      dir:    cam.target.subtract(cam.position).normalize(),
    }
  }

  /** Teleport player to a new position */
  resetPosition(x: number, y: number, z: number) {
    this.position.set(x, y, z)
    this.velocity.setAll(0)
    this.onGround = false
  }

  /** Get state for network sync */
  getState(): PlayerState {
    return {
      x:    this.position.x,
      y:    this.position.y,
      z:    this.position.z,
      ry:   this.facingY,
      anim: this.currentAnim,
    }
  }
}
