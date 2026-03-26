import '@babylonjs/loaders/glTF'
import {
  Scene,
  Vector3,
  SceneLoader,
  TransformNode,
  AbstractMesh,
  AnimationGroup,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core'
import type { Terrain } from './terrain'

const HUMAN_FILE = './assets/human/human_comprehensive.glb'

export type EnemyType = 'normal' | 'shooter' | 'flyer' | 'giant' | 'speedster'

interface EnemyConfig {
  scale: number
  detectRange: number
  chaseSpeed: number
  patrolSpeed: number
  catchDist: number
  flies: boolean
  flyHeight: number
  shootInterval: number
  tint: Color3 | null
}

const CONFIGS: Record<EnemyType, EnemyConfig> = {
  normal:    { scale: 384,  detectRange: 60, chaseSpeed: 20,   patrolSpeed: 8,   catchDist: 6,   flies: false, flyHeight: 0,  shootInterval: 0,   tint: null },
  shooter:   { scale: 384,  detectRange: 80, chaseSpeed: 14,   patrolSpeed: 6,   catchDist: 6,   flies: false, flyHeight: 0,  shootInterval: 1.5, tint: new Color3(1, 0.3, 0.1) },
  flyer:     { scale: 384,  detectRange: 70, chaseSpeed: 24,   patrolSpeed: 10,  catchDist: 6,   flies: true,  flyHeight: 25, shootInterval: 0,   tint: new Color3(0.3, 0.7, 1) },
  giant:     { scale: 1536, detectRange: 80, chaseSpeed: 16,   patrolSpeed: 6,   catchDist: 12,  flies: false, flyHeight: 0,  shootInterval: 0,   tint: new Color3(0.6, 0.2, 0.2) },
  speedster: { scale: 192,  detectRange: 50, chaseSpeed: 30,   patrolSpeed: 12,  catchDist: 4,   flies: false, flyHeight: 0,  shootInterval: 0,   tint: new Color3(1, 1, 0.2) },
}

export interface Bullet {
  mesh: Mesh
  position: Vector3
  direction: Vector3
  speed: number
  life: number
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

export class Enemy {
  readonly position = new Vector3()
  readonly type: EnemyType
  readonly bullets: Bullet[] = []
  private spawnPos = new Vector3()
  private root: TransformNode | null = null
  private yOffset = 0
  facingY = 0
  private chasing = false
  private animGroups = new Map<string, AnimationGroup>()
  private currentAnimName = ''
  private patrolAngle = 0
  private loaded = false
  private cfg: EnemyConfig
  private shootTimer = 0

  constructor(
    private scene: Scene,
    private terrain: Terrain,
    x: number, z: number,
    type: EnemyType = 'normal',
  ) {
    this.type = type
    this.cfg = CONFIGS[type]
    const surfY = terrain.getSurfaceY(x, z)
    const baseY = this.cfg.flies ? surfY + this.cfg.flyHeight : surfY + 0.1
    this.position.set(x, baseY, z)
    this.spawnPos.copyFrom(this.position)
    this.patrolAngle = Math.random() * Math.PI * 2
    this.shootTimer = this.cfg.shootInterval * Math.random()
    this.load()
  }

  private async load() {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', HUMAN_FILE, this.scene)
      this.root = new TransformNode('enemy_root', this.scene)
      result.meshes.forEach((m: AbstractMesh) => { if (!m.parent) m.parent = this.root! })
      this.root.scaling.setAll(this.cfg.scale)
      this.root.position.copyFrom(this.position)

      this.scene.incrementRenderId()
      result.meshes.forEach((m: AbstractMesh) => m.computeWorldMatrix(true))
      this.yOffset = -meshBottomY(result.meshes)

      // Apply tint to distinguish enemy types
      if (this.cfg.tint) {
        for (const m of result.meshes) {
          if (m.material && 'diffuseColor' in m.material) {
            const cloned = m.material.clone(m.material.name + '_tint') as StandardMaterial
            cloned.diffuseColor = this.cfg.tint
            m.material = cloned
          }
        }
      }

      for (const ag of result.animationGroups) {
        const name = ag.name.toLowerCase()
        this.animGroups.set(name, ag)
        ag.stop()
      }

      this.playAnim('idle')
      this.loaded = true
    } catch (err) {
      console.warn('[Enemy] Failed to load human model', err)
    }
  }

  private playAnim(name: string) {
    if (name === this.currentAnimName) return
    const prev = this.animGroups.get(this.currentAnimName)
    if (prev) prev.stop()
    let ag = this.animGroups.get(name)
    if (!ag) {
      for (const [key, group] of this.animGroups) {
        if (key.includes(name)) { ag = group; break }
      }
    }
    if (ag) { ag.start(true, 0.2); this.currentAnimName = name }
  }

  /** Returns true if the enemy caught the player */
  update(dt: number, playerPos: Vector3, remotePos: Vector3 | null): boolean {
    if (!this.loaded) return false

    let targetPos = playerPos
    if (remotePos) {
      const dLocal  = Vector3.Distance(this.position, playerPos)
      const dRemote = Vector3.Distance(this.position, remotePos)
      if (dRemote < dLocal) targetPos = remotePos
    }

    // Patrol only — no chasing
    this.chasing = false
    this.patrolAngle += dt * 0.3
    const px = this.spawnPos.x + Math.sin(this.patrolAngle) * 20
    const pz = this.spawnPos.z + Math.cos(this.patrolAngle) * 20
    const pdx = px - this.position.x
    const pdz = pz - this.position.z
    const pDist = Math.sqrt(pdx * pdx + pdz * pdz)
    if (pDist > 0.5) {
      this.facingY = Math.atan2(pdx, pdz)
      const speed = Math.min(this.cfg.patrolSpeed * dt, pDist)
      this.position.x += (pdx / pDist) * speed
      this.position.z += (pdz / pDist) * speed
      this.playAnim('walk')
    } else {
      this.playAnim('idle')
    }

    // Ground/fly snap
    if (this.cfg.flies) {
      const surfY = this.terrain.getSurfaceY(this.position.x, this.position.z)
      if (this.position.y < surfY + 2) this.position.y = surfY + 2
    } else {
      const surfY = this.terrain.getSurfaceY(this.position.x, this.position.z)
      this.position.y = surfY + 0.1
    }

    if (this.root) {
      this.root.position.set(this.position.x, this.position.y + this.yOffset, this.position.z)
      this.root.rotation.y = this.facingY
    }

    this.updateBullets(dt)

    return false
  }

  /** Check if any bullet hit the player */
  checkBulletHit(playerPos: Vector3): boolean {
    const HIT_DIST = 1.5
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      if (Vector3.Distance(this.bullets[i].position, playerPos) < HIT_DIST) {
        this.bullets[i].mesh.dispose()
        this.bullets.splice(i, 1)
        return true
      }
    }
    return false
  }

  private spawnBullet(target: Vector3) {
    const dir = target.subtract(this.position).normalize()
    const bullet = MeshBuilder.CreateSphere('bullet', { diameter: 0.6 }, this.scene)
    bullet.position.copyFrom(this.position)
    const mat = new StandardMaterial('bulletMat', this.scene)
    mat.diffuseColor = new Color3(1, 0.2, 0)
    mat.emissiveColor = new Color3(1, 0.4, 0)
    bullet.material = mat
    this.bullets.push({ mesh: bullet, position: bullet.position, direction: dir, speed: 25, life: 4 })
  }

  private updateBullets(dt: number) {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]
      b.life -= dt
      if (b.life <= 0) { b.mesh.dispose(); this.bullets.splice(i, 1); continue }
      b.position.addInPlace(b.direction.scale(b.speed * dt))
    }
  }

  dispose() {
    if (this.root) {
      for (const ag of this.animGroups.values()) ag.stop()
      this.root.getChildMeshes(true).forEach(m => m.dispose())
      this.root.dispose()
      this.root = null
    }
    for (const b of this.bullets) b.mesh.dispose()
    this.bullets.length = 0
  }

  /** Apply position from host (joiner only) */
  applyNetState(x: number, y: number, z: number, ry: number): void {
    this.position.set(x, y, z)
    this.facingY = ry
    if (this.root) {
      this.root.position.set(x, y + this.yOffset, z)
      this.root.rotation.y = ry
    }
  }
}
