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
} from '@babylonjs/core'
import type { Terrain } from './terrain'
import type { AnimState, PlayerState } from './types'

// ── Movement constants ───────────────────────────────────────────────────────
const GRAVITY       = -28
const JUMP_VELOCITY = 14
const MOVE_SPEED    = 8
const PLAYER_HEIGHT = 1.2
const PLAYER_RADIUS = 0.4
const TERMINAL_VEL  = -30
const ANT_SCALE     = 1.8

// ── Camera constants ─────────────────────────────────────────────────────────
const CAM_DEFAULT_RADIUS = 14
const CAM_MIN_RADIUS     = 2     // close enough to see dog head at screen bottom
const CAM_LERP_SPEED     = 12   // how fast the radius adjusts (units/sec)

const SPAWN = new Vector3(0, 4, 0)

const ANT_ANIM_FILES: Record<AnimState, string> = {
  idle: './assets/ant/idle.glb',
  run:  './assets/ant/run.glb',
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

  // Camera mode: 1=dynamic radius, 2=fixed orbit, 3=first-person
  private cameraMode: 1 | 2 | 3 = 1

  constructor(scene: Scene, terrain: Terrain) {
    this.scene = scene
    this.terrain = terrain
    this.setupCamera()
    this.setupInput()
    this.loadModel()
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

  private setCameraMode(m: 1 | 2 | 3): void {
    if (m === this.cameraMode) return
    this.cameraMode = m
    const cam = this.camera
    if (m === 3) {
      cam.lowerBetaLimit = 0.05
      cam.upperBetaLimit = Math.PI * 0.95
      cam.upperRadiusLimit = null  // allow large radius for FPS trick
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

    // ── Gravity ────────────────────────────────────────────────────────────
    this.velocity.y += GRAVITY * dt
    if (this.velocity.y < TERMINAL_VEL) this.velocity.y = TERMINAL_VEL

    // ── Move position (split axes to prevent entering solid terrain) ───────
    // Apply Y first (gravity / jump)
    this.position.y += this.velocity.y * dt

    // Apply X — check at knee and mid-body before committing
    // Use knee height (0.45) so small slopes are walkable
    const newX = this.position.x + this.velocity.x * dt
    const solidAtKneeX = this.terrain.isSolid(newX, this.position.y + 0.45, this.position.z)
    const solidAtMidX  = this.terrain.isSolid(newX, this.position.y + PLAYER_HEIGHT * 0.5, this.position.z)
    if (!solidAtKneeX && !solidAtMidX) {
      this.position.x = newX
    } else {
      this.velocity.x = 0
    }

    // Apply Z — check at knee and mid-body before committing
    const newZ = this.position.z + this.velocity.z * dt
    const solidAtKneeZ = this.terrain.isSolid(this.position.x, this.position.y + 0.45, newZ)
    const solidAtMidZ  = this.terrain.isSolid(this.position.x, this.position.y + PLAYER_HEIGHT * 0.5, newZ)
    if (!solidAtKneeZ && !solidAtMidZ) {
      this.position.z = newZ
    } else {
      this.velocity.z = 0
    }

    // ── Terrain collision ──────────────────────────────────────────────────
    this.onGround = false

    // Find the nearest solid surface below the player's feet
    const surfaceY = this.terrain.getSurfaceYBelow(this.position.x, this.position.z, this.position.y)

    if (this.position.y <= surfaceY + 0.1 && this.velocity.y <= 0) {
      // Landing on a surface below us (works for tunnel floors too)
      this.position.y = surfaceY + 0.1
      this.velocity.y = 0
      this.onGround = true
    }

    // Ceiling check: if head hits solid terrain above, kill upward velocity
    if (this.velocity.y > 0 && this.terrain.isSolid(this.position.x, this.position.y + PLAYER_HEIGHT, this.position.z)) {
      this.velocity.y = 0
    }

    // World floor (bottom of terrain grid)
    if (this.position.y < -35) {
      this.position.copyFrom(SPAWN)
      this.velocity.setAll(0)
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
      this.playAnim('run')
    } else {
      this.playAnim('idle')
    }

    // ── Sync model to position ─────────────────────────────────────────────
    if (this.modelRoot) {
      // Hide model in FPS mode so you don't see your own fox
      this.modelRoot.setEnabled(this.cameraMode !== 3)
      this.modelRoot.position.x = this.position.x
      this.modelRoot.position.z = this.position.z
      // Subtract yOffset so the model's feet (not its origin) land at position.y
      const entry = this.anims.get(this.currentAnim)
      const yOff = entry ? entry.yOffset : 0
      this.modelRoot.position.y = this.position.y - yOff
      this.modelRoot.rotation.y = this.facingY
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
   * Works correctly for all three camera modes.
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
