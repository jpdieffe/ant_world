import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
} from '@babylonjs/core'
import type { Terrain } from './terrain'

export type CritterType = 'spider' | 'pillbug'

interface CritterConfig {
  scale: number
  speed: number
  wanderRadius: number
  pauseMin: number
  pauseMax: number
}

const CONFIGS: Record<CritterType, CritterConfig> = {
  spider:  { scale: 30, speed: 6, wanderRadius: 80, pauseMin: 0.5, pauseMax: 2 },
  pillbug: { scale: 6,  speed: 2, wanderRadius: 50, pauseMin: 2,   pauseMax: 5 },
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

export class Critter {
  readonly position = new Vector3()

  private walkRoot: TransformNode | null = null
  private idleRoot: TransformNode | null = null
  private walkAnim: AnimationGroup | null = null
  private idleAnim: AnimationGroup | null = null
  private walkYOff = 0
  private idleYOff = 0

  private loaded = false
  private moving = false
  private pauseTimer = 0
  private targetX = 0
  private targetZ = 0
  private facingY = 0

  private readonly cfg: CritterConfig
  private readonly spawnX: number
  private readonly spawnZ: number

  constructor(
    private scene: Scene,
    private terrain: Terrain,
    x: number, z: number,
    private type: CritterType,
  ) {
    this.cfg = CONFIGS[type]
    this.spawnX = x
    this.spawnZ = z
    const surfY = terrain.getSurfaceY(x, z)
    this.position.set(x, surfY, z)
    this.pickTarget()
    this.load()
  }

  private pickTarget(): void {
    const angle = Math.random() * Math.PI * 2
    const dist  = 20 + Math.random() * this.cfg.wanderRadius
    this.targetX = Math.max(
      this.terrain.worldMinX + 10,
      Math.min(this.terrain.worldMaxX - 10, this.spawnX + Math.cos(angle) * dist),
    )
    this.targetZ = Math.max(
      this.terrain.worldMinZ + 10,
      Math.min(this.terrain.worldMaxZ - 10, this.spawnZ + Math.sin(angle) * dist),
    )
    this.pauseTimer = this.cfg.pauseMin + Math.random() * (this.cfg.pauseMax - this.cfg.pauseMin)
    this.moving = false
  }

  private async load(): Promise<void> {
    const base = `./assets/${this.type}/`
    try {
      // Walk animation
      const walkRes = await SceneLoader.ImportMeshAsync('', '', base + 'walk.glb', this.scene)
      this.walkRoot = new TransformNode(`${this.type}_walk_${Math.random()}`, this.scene)
      const walkMeshes = walkRes.meshes.filter(m => m !== walkRes.meshes[0])
      this.walkYOff = meshBottomY(walkMeshes) * this.cfg.scale
      for (const m of walkMeshes) m.parent = this.walkRoot
      walkRes.meshes[0].dispose()
      this.walkRoot.scaling.setAll(this.cfg.scale)
      this.walkAnim = walkRes.animationGroups[0] ?? null
      if (this.walkAnim) { this.walkAnim.stop(); this.walkAnim.loopAnimation = true }
      this.walkRoot.setEnabled(false)

      // Idle animation
      const idleRes = await SceneLoader.ImportMeshAsync('', '', base + 'idle.glb', this.scene)
      this.idleRoot = new TransformNode(`${this.type}_idle_${Math.random()}`, this.scene)
      const idleMeshes = idleRes.meshes.filter(m => m !== idleRes.meshes[0])
      this.idleYOff = meshBottomY(idleMeshes) * this.cfg.scale
      for (const m of idleMeshes) m.parent = this.idleRoot
      idleRes.meshes[0].dispose()
      this.idleRoot.scaling.setAll(this.cfg.scale)
      this.idleAnim = idleRes.animationGroups[0] ?? null
      if (this.idleAnim) { this.idleAnim.stop(); this.idleAnim.loopAnimation = true }

      // Start in idle
      this.idleRoot.setEnabled(true)
      this.idleAnim?.start(true)
      this.loaded = true
    } catch (err) {
      console.warn(`[Critter] Failed to load ${this.type}:`, err)
    }
  }

  private showWalk(): void {
    this.idleRoot?.setEnabled(false)
    this.idleAnim?.stop()
    this.walkRoot?.setEnabled(true)
    this.walkAnim?.start(true)
  }

  private showIdle(): void {
    this.walkRoot?.setEnabled(false)
    this.walkAnim?.stop()
    this.idleRoot?.setEnabled(true)
    this.idleAnim?.start(true)
  }

  update(dt: number): void {
    if (!this.loaded) return

    if (!this.moving) {
      this.pauseTimer -= dt
      if (this.pauseTimer <= 0) {
        this.moving = true
        this.showWalk()
      }
    } else {
      const dx = this.targetX - this.position.x
      const dz = this.targetZ - this.position.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist < 2) {
        this.pickTarget()
        this.showIdle()
      } else {
        this.facingY = Math.atan2(dx, dz)
        const step = Math.min(this.cfg.speed * dt, dist)
        this.position.x += (dx / dist) * step
        this.position.z += (dz / dist) * step
      }
    }

    // Snap to terrain surface
    const surfY = this.terrain.getSurfaceY(this.position.x, this.position.z)
    this.position.y = surfY

    // Sync mesh positions
    const activeRoot = this.moving ? this.walkRoot : this.idleRoot
    const activeYOff = this.moving ? this.walkYOff : this.idleYOff
    if (activeRoot) {
      activeRoot.position.set(this.position.x, this.position.y - activeYOff, this.position.z)
      activeRoot.rotation.y = this.facingY
    }
  }

  dispose(): void {
    this.walkAnim?.stop()
    this.idleAnim?.stop()
    if (this.walkRoot) {
      this.walkRoot.getChildMeshes(true).forEach(m => m.dispose())
      this.walkRoot.dispose()
    }
    if (this.idleRoot) {
      this.idleRoot.getChildMeshes(true).forEach(m => m.dispose())
      this.idleRoot.dispose()
    }
  }
}
