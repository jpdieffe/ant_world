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

// ── Constants ────────────────────────────────────────────────────────────────
const ANT_SCALE = 2.16
const QUEEN_SCALE = 4.0
const EGG_HATCH_TIME = 30       // seconds until egg hatches
const EGG_LAY_INTERVAL = 60     // seconds between egg lays
const FOOD_BOUNCE_GRAVITY = -40
const FOOD_RADIUS = 0.6
const TRAIL_POINT_SPACING = 3   // world units between trail points
const TRAIL_LIFETIME = 120      // seconds before trail fades
const ALLY_SPEED = 6
const ALLY_WANDER_RADIUS = 80
const FOOD_DELIVER_DIST = 8     // how close to queen to deliver food
const FOOD_PICKUP_DIST = 4

function meshBottomY(meshes: AbstractMesh[]): number {
  let minY = Infinity
  for (const m of meshes) {
    m.computeWorldMatrix(true)
    const worldMin = m.getBoundingInfo().boundingBox.minimumWorld.y
    if (worldMin < minY) minY = worldMin
  }
  return minY === Infinity ? 0 : minY
}

// ── Trail System ─────────────────────────────────────────────────────────────
export interface TrailPoint {
  position: Vector3
  age: number
  mesh: Mesh
}

export class TrailSystem {
  points: TrailPoint[] = []
  private scene: Scene
  private trailMat: StandardMaterial
  private lastDropPos: Vector3 | null = null

  constructor(scene: Scene) {
    this.scene = scene
    this.trailMat = new StandardMaterial('trailMat', scene)
    this.trailMat.diffuseColor = new Color3(0.2, 0.8, 1.0)
    this.trailMat.emissiveColor = new Color3(0.1, 0.4, 0.5)
    this.trailMat.alpha = 0.6
  }

  dropPoint(pos: Vector3): void {
    if (this.lastDropPos && Vector3.Distance(pos, this.lastDropPos) < TRAIL_POINT_SPACING) return
    this.lastDropPos = pos.clone()
    const mesh = MeshBuilder.CreateSphere('trail', { diameter: 0.8 }, this.scene)
    mesh.position.copyFrom(pos)
    mesh.position.y += 0.3
    mesh.material = this.trailMat
    mesh.isPickable = false
    this.points.push({ position: pos.clone(), age: 0, mesh })
  }

  update(dt: number): void {
    for (let i = this.points.length - 1; i >= 0; i--) {
      this.points[i].age += dt
      if (this.points[i].age > TRAIL_LIFETIME) {
        this.points[i].mesh.dispose()
        this.points.splice(i, 1)
      } else {
        // Fade out
        const alpha = 1 - this.points[i].age / TRAIL_LIFETIME
        this.points[i].mesh.scaling.setAll(alpha * 0.8 + 0.2)
      }
    }
  }

  findNearestPoint(pos: Vector3, maxDist: number): TrailPoint | null {
    let best: TrailPoint | null = null
    let bestDist = maxDist
    for (const pt of this.points) {
      const d = Vector3.Distance(pos, pt.position)
      if (d < bestDist) { bestDist = d; best = pt }
    }
    return best
  }

  findNextPointAlong(pos: Vector3, currentIdx: number): TrailPoint | null {
    // Find the nearest trail point, then return the next one in sequence
    if (this.points.length < 2) return null
    let nearIdx = -1
    let nearDist = Infinity
    for (let i = 0; i < this.points.length; i++) {
      const d = Vector3.Distance(pos, this.points[i].position)
      if (d < nearDist) { nearDist = d; nearIdx = i }
    }
    // Try to follow trail forward (newer points)
    if (nearIdx >= 0 && nearIdx < this.points.length - 1) {
      return this.points[nearIdx + 1]
    }
    return null
  }

  dispose(): void {
    for (const pt of this.points) pt.mesh.dispose()
    this.points.length = 0
  }
}

// ── Food (bouncing green balls) ──────────────────────────────────────────────
export class Food {
  mesh: Mesh
  position: Vector3
  velocity: Vector3
  settled = false
  private bounceCount = 0

  constructor(scene: Scene, x: number, y: number, z: number) {
    this.position = new Vector3(x, y, z)
    this.velocity = new Vector3(
      (Math.random() - 0.5) * 8,
      6 + Math.random() * 4,
      (Math.random() - 0.5) * 8,
    )
    this.mesh = MeshBuilder.CreateSphere('food', { diameter: FOOD_RADIUS * 2 }, scene)
    this.mesh.position.copyFrom(this.position)
    const mat = new StandardMaterial('foodMat', scene)
    mat.diffuseColor = new Color3(0.15, 0.85, 0.15)
    mat.emissiveColor = new Color3(0.05, 0.3, 0.05)
    this.mesh.material = mat
    this.mesh.isPickable = false
  }

  update(dt: number, terrain: Terrain): void {
    if (this.settled) return
    this.velocity.y += FOOD_BOUNCE_GRAVITY * dt
    this.position.addInPlace(this.velocity.scale(dt))

    const surfY = terrain.getSurfaceY(this.position.x, this.position.z)
    if (this.position.y <= surfY + FOOD_RADIUS) {
      this.position.y = surfY + FOOD_RADIUS
      this.bounceCount++
      if (this.bounceCount >= 3) {
        this.settled = true
        this.velocity.setAll(0)
      } else {
        this.velocity.y = Math.abs(this.velocity.y) * 0.5
        this.velocity.x *= 0.6
        this.velocity.z *= 0.6
      }
    }
    this.mesh.position.copyFrom(this.position)
  }

  dispose(): void {
    this.mesh.dispose()
  }
}

// ── Egg ──────────────────────────────────────────────────────────────────────
export class Egg {
  mesh: Mesh
  position: Vector3
  timer: number

  constructor(scene: Scene, x: number, y: number, z: number) {
    this.position = new Vector3(x, y, z)
    this.timer = EGG_HATCH_TIME
    this.mesh = MeshBuilder.CreateSphere('egg', { diameter: 1.2 }, scene)
    this.mesh.position.copyFrom(this.position)
    const mat = new StandardMaterial('eggMat', scene)
    mat.diffuseColor = new Color3(0.95, 0.92, 0.8)
    mat.emissiveColor = new Color3(0.1, 0.09, 0.06)
    this.mesh.material = mat
    this.mesh.isPickable = false
  }

  update(dt: number): boolean {
    this.timer -= dt
    // Pulsate as it gets closer to hatching
    const pulse = 1 + Math.sin(this.timer * 4) * 0.05 * (1 - this.timer / EGG_HATCH_TIME)
    this.mesh.scaling.setAll(pulse)
    return this.timer <= 0
  }

  dispose(): void {
    this.mesh.dispose()
  }
}

// ── Ant Queen ────────────────────────────────────────────────────────────────
export class AntQueen {
  position: Vector3
  health = 100
  maxHealth = 100
  private root: TransformNode | null = null
  private idleAnim: AnimationGroup | null = null
  private yOffset = 0
  private loaded = false
  private scene: Scene
  private isEnemy: boolean

  constructor(scene: Scene, x: number, y: number, z: number, isEnemy = false) {
    this.scene = scene
    this.position = new Vector3(x, y, z)
    this.isEnemy = isEnemy
    this.load()
  }

  private async load() {
    try {
      const result = await SceneLoader.ImportMeshAsync('', '', './assets/ant/idle.glb', this.scene)
      this.root = new TransformNode('queen_root', this.scene)
      const meshes = result.meshes.filter(m => m !== result.meshes[0])
      this.yOffset = meshBottomY(meshes) * QUEEN_SCALE
      for (const m of meshes) {
        m.parent = this.root
        // Tint red for enemy queen
        if (this.isEnemy && m.material && 'diffuseColor' in m.material) {
          const cloned = m.material.clone(m.material.name + '_queenTint') as StandardMaterial
          cloned.diffuseColor = new Color3(0.9, 0.15, 0.1)
          cloned.emissiveColor = new Color3(0.3, 0.02, 0.01)
          m.material = cloned
        }
      }
      result.meshes[0].dispose()
      this.root.scaling.setAll(QUEEN_SCALE)
      this.root.position.set(this.position.x, this.position.y - this.yOffset, this.position.z)

      this.idleAnim = result.animationGroups[0] ?? null
      if (this.idleAnim) { this.idleAnim.loopAnimation = true; this.idleAnim.start(true) }
      this.loaded = true
    } catch (err) {
      console.warn('[AntQueen] Failed to load:', err)
    }
  }

  feedFood(amount: number): void {
    this.health = Math.min(this.maxHealth, this.health + amount)
  }

  takeDamage(amount: number): void {
    this.health -= amount
  }

  isAlive(): boolean {
    return this.health > 0
  }

  update(_dt: number): void {
    if (!this.loaded || !this.root) return
    this.root.position.set(this.position.x, this.position.y - this.yOffset, this.position.z)
  }

  dispose(): void {
    this.idleAnim?.stop()
    if (this.root) {
      this.root.getChildMeshes(true).forEach(m => m.dispose())
      this.root.dispose()
      this.root = null
    }
  }
}

// ── Ally Ant ─────────────────────────────────────────────────────────────────
type AllyState = 'wander' | 'followTrail' | 'returnFood' | 'goToQueen'

export class AllyAnt {
  position: Vector3
  facingY = 0
  private state: AllyState = 'wander'
  private carryingFood: Food | null = null

  private walkRoot: TransformNode | null = null
  private idleRoot: TransformNode | null = null
  private walkAnim: AnimationGroup | null = null
  private idleAnim: AnimationGroup | null = null
  private walkYOff = 0
  private idleYOff = 0
  private loaded = false
  private moving = false
  private pauseTimer = 0
  private targetPos: Vector3
  private scene: Scene
  private terrain: Terrain
  private nestPos: Vector3
  private isEnemy: boolean

  constructor(scene: Scene, terrain: Terrain, x: number, y: number, z: number, nestPos: Vector3, isEnemy = false) {
    this.scene = scene
    this.terrain = terrain
    this.position = new Vector3(x, y, z)
    this.targetPos = new Vector3(x, y, z)
    this.nestPos = nestPos.clone()
    this.isEnemy = isEnemy
    this.pickWanderTarget()
    this.load()
  }

  private async load() {
    try {
      const base = './assets/ant/'
      // Idle
      const idleRes = await SceneLoader.ImportMeshAsync('', '', base + 'idle.glb', this.scene)
      this.idleRoot = new TransformNode(`ally_idle_${Math.random()}`, this.scene)
      const idleMeshes = idleRes.meshes.filter(m => m !== idleRes.meshes[0])
      this.idleYOff = meshBottomY(idleMeshes) * ANT_SCALE
      for (const m of idleMeshes) {
        m.parent = this.idleRoot
        if (this.isEnemy && m.material && 'diffuseColor' in m.material) {
          const cloned = m.material.clone(m.material.name + '_redAnt') as StandardMaterial
          cloned.diffuseColor = new Color3(0.85, 0.12, 0.08)
          cloned.emissiveColor = new Color3(0.25, 0.02, 0.01)
          m.material = cloned
        }
      }
      idleRes.meshes[0].dispose()
      this.idleRoot.scaling.setAll(ANT_SCALE)
      this.idleAnim = idleRes.animationGroups[0] ?? null
      if (this.idleAnim) { this.idleAnim.stop(); this.idleAnim.loopAnimation = true }

      // Walk
      const walkRes = await SceneLoader.ImportMeshAsync('', '', base + 'walk.glb', this.scene)
      this.walkRoot = new TransformNode(`ally_walk_${Math.random()}`, this.scene)
      const walkMeshes = walkRes.meshes.filter(m => m !== walkRes.meshes[0])
      this.walkYOff = meshBottomY(walkMeshes) * ANT_SCALE
      for (const m of walkMeshes) {
        m.parent = this.walkRoot
        if (this.isEnemy && m.material && 'diffuseColor' in m.material) {
          const cloned = m.material.clone(m.material.name + '_redAnt') as StandardMaterial
          cloned.diffuseColor = new Color3(0.85, 0.12, 0.08)
          cloned.emissiveColor = new Color3(0.25, 0.02, 0.01)
          m.material = cloned
        }
      }
      walkRes.meshes[0].dispose()
      this.walkRoot.scaling.setAll(ANT_SCALE)
      this.walkAnim = walkRes.animationGroups[0] ?? null
      if (this.walkAnim) { this.walkAnim.stop(); this.walkAnim.loopAnimation = true }
      this.walkRoot.setEnabled(false)

      this.idleRoot.setEnabled(true)
      this.idleAnim?.start(true)
      this.loaded = true
    } catch (err) {
      console.warn('[AllyAnt] Failed to load:', err)
    }
  }

  private showWalk(): void {
    if (this.moving) return
    this.moving = true
    this.idleRoot?.setEnabled(false)
    this.idleAnim?.stop()
    this.walkRoot?.setEnabled(true)
    this.walkAnim?.start(true)
  }

  private showIdle(): void {
    if (!this.moving) return
    this.moving = false
    this.walkRoot?.setEnabled(false)
    this.walkAnim?.stop()
    this.idleRoot?.setEnabled(true)
    this.idleAnim?.start(true)
  }

  private pickWanderTarget(): void {
    // Wander near the nest entrance (surface above nest)
    const angle = Math.random() * Math.PI * 2
    const dist = 20 + Math.random() * ALLY_WANDER_RADIUS
    const x = Math.max(
      this.terrain.worldMinX + 10,
      Math.min(this.terrain.worldMaxX - 10, this.nestPos.x + Math.cos(angle) * dist),
    )
    const z = Math.max(
      this.terrain.worldMinZ + 10,
      Math.min(this.terrain.worldMaxZ - 10, this.nestPos.z + Math.sin(angle) * dist),
    )
    const y = this.terrain.getSurfaceY(x, z)
    this.targetPos.set(x, y, z)
    this.pauseTimer = 1 + Math.random() * 3
  }

  update(dt: number, foods: Food[], queenPos: Vector3, trail: TrailSystem): void {
    if (!this.loaded) return

    // State machine
    switch (this.state) {
      case 'wander': {
        if (this.pauseTimer > 0) {
          this.pauseTimer -= dt
          this.showIdle()
          break
        }
        this.showWalk()
        // Sometimes check for trail (30% chance each second)
        if (!this.isEnemy && Math.random() < 0.3 * dt && trail.points.length > 3) {
          const nearTrail = trail.findNearestPoint(this.position, 30)
          if (nearTrail) {
            this.state = 'followTrail'
            this.targetPos.copyFrom(nearTrail.position)
            break
          }
        }
        // Check for nearby food
        const nearbyFood = this.findNearbyFood(foods)
        if (nearbyFood) {
          this.pickUpFood(nearbyFood, foods)
          this.state = 'goToQueen'
          this.targetPos.copyFrom(queenPos)
          break
        }
        this.moveToward(this.targetPos, dt)
        if (this.distXZ(this.targetPos) < 3) {
          this.pickWanderTarget()
        }
        break
      }
      case 'followTrail': {
        this.showWalk()
        this.moveToward(this.targetPos, dt)
        if (this.distXZ(this.targetPos) < 3) {
          const next = trail.findNextPointAlong(this.position, 0)
          if (next) {
            this.targetPos.copyFrom(next.position)
          } else {
            this.state = 'wander'
            this.pickWanderTarget()
          }
        }
        // Check for food along the trail
        const nearbyFood2 = this.findNearbyFood(foods)
        if (nearbyFood2) {
          this.pickUpFood(nearbyFood2, foods)
          this.state = 'goToQueen'
          this.targetPos.copyFrom(queenPos)
        }
        break
      }
      case 'goToQueen': {
        this.showWalk()
        this.moveToward(this.targetPos, dt)
        if (this.distXZ(queenPos) < FOOD_DELIVER_DIST) {
          // Deliver food
          if (this.carryingFood) {
            this.carryingFood.dispose()
            this.carryingFood = null
          }
          this.state = 'wander'
          this.pickWanderTarget()
          return // signal to colony that food was delivered
        }
        break
      }
    }

    // Snap to terrain
    const surfY = this.terrain.getSurfaceY(this.position.x, this.position.z)
    this.position.y = surfY

    // Sync mesh
    const activeRoot = this.moving ? this.walkRoot : this.idleRoot
    const activeYOff = this.moving ? this.walkYOff : this.idleYOff
    if (activeRoot) {
      activeRoot.position.set(this.position.x, this.position.y - activeYOff, this.position.z)
      activeRoot.rotation.y = this.facingY
    }

    // Carried food follows ant
    if (this.carryingFood) {
      this.carryingFood.position.set(this.position.x, this.position.y + 1.5, this.position.z)
      this.carryingFood.mesh.position.copyFrom(this.carryingFood.position)
    }
  }

  isDeliveringFood(): boolean {
    return this.state === 'goToQueen' && this.carryingFood !== null
  }

  justDelivered(queenPos: Vector3): boolean {
    return this.state === 'wander' && !this.carryingFood && this.distXZ(queenPos) < FOOD_DELIVER_DIST + 2
  }

  private moveToward(target: Vector3, dt: number): void {
    const dx = target.x - this.position.x
    const dz = target.z - this.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (dist > 1) {
      this.facingY = Math.atan2(dx, dz)
      const step = Math.min(ALLY_SPEED * dt, dist)
      this.position.x += (dx / dist) * step
      this.position.z += (dz / dist) * step
    }
  }

  private distXZ(target: Vector3): number {
    const dx = target.x - this.position.x
    const dz = target.z - this.position.z
    return Math.sqrt(dx * dx + dz * dz)
  }

  private findNearbyFood(foods: Food[]): Food | null {
    for (const food of foods) {
      if (!food.settled) continue
      if (Vector3.Distance(this.position, food.position) < FOOD_PICKUP_DIST) return food
    }
    return null
  }

  private pickUpFood(food: Food, foods: Food[]): void {
    this.carryingFood = food
    const idx = foods.indexOf(food)
    if (idx >= 0) foods.splice(idx, 1)
  }

  dispose(): void {
    this.walkAnim?.stop()
    this.idleAnim?.stop()
    if (this.walkRoot && this.walkRoot !== this.idleRoot) {
      this.walkRoot.getChildMeshes(true).forEach(m => m.dispose())
      this.walkRoot.dispose()
    }
    if (this.idleRoot) {
      this.idleRoot.getChildMeshes(true).forEach(m => m.dispose())
      this.idleRoot.dispose()
    }
    this.carryingFood?.dispose()
  }
}

// ── Colony (manages queen, eggs, allies) ──────────────────────────────────────
export class Colony {
  queen: AntQueen
  eggs: Egg[] = []
  allies: AllyAnt[] = []
  private eggTimer = EGG_LAY_INTERVAL
  private scene: Scene
  private terrain: Terrain
  readonly nestX: number
  readonly nestZ: number
  readonly nestY: number    // depth of queen chamber
  readonly entranceY: number // surface level above nest
  readonly isEnemy: boolean
  score = 0

  constructor(scene: Scene, terrain: Terrain, nestX: number, nestZ: number, isEnemy = false) {
    this.scene = scene
    this.terrain = terrain
    this.nestX = nestX
    this.nestZ = nestZ
    this.isEnemy = isEnemy

    // Queen sits at the bottom of the nest tunnel (~halfway down the terrain depth)
    // Terrain goes from Y=0 surface down to Y=-200
    // Halfway = -100
    this.nestY = -100
    this.entranceY = terrain.getSurfaceY(nestX, nestZ)

    // Carve the nest: tunnel from surface down to chamber
    this.carveNest(terrain)

    // Place queen in the chamber
    this.queen = new AntQueen(scene, nestX, this.nestY + 1, nestZ, isEnemy)
  }

  private carveNest(terrain: Terrain): void {
    // Carve a sloping tunnel from the surface to the queen chamber
    // The tunnel goes at a nice ~30 degree angle
    const surfY = this.entranceY
    const depth = this.nestY
    const tunnelLength = Math.abs(surfY - depth)

    // Tunnel slopes in X direction
    const tunnelDx = tunnelLength * 0.6 // horizontal spread for gentle slope
    const steps = 40
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const x = this.nestX + tunnelDx * t * (this.isEnemy ? -1 : 1)
      const y = surfY - (surfY - depth) * t
      const z = this.nestZ + Math.sin(t * Math.PI * 2) * 8 // slight S-curve
      terrain.carveTunnel(
        i === 0 ? this.nestX : this.nestX + tunnelDx * ((i - 1) / steps) * (this.isEnemy ? -1 : 1),
        i === 0 ? surfY : surfY - (surfY - depth) * ((i - 1) / steps),
        i === 0 ? this.nestZ : this.nestZ + Math.sin(((i - 1) / steps) * Math.PI * 2) * 8,
        x, y, z, 8,
      )
    }

    // Carve the queen's chamber (wider area at the bottom)
    terrain.carveChamber(this.nestX + tunnelDx * (this.isEnemy ? -1 : 1) * 0.95, this.nestY, this.nestZ, 15)
  }

  update(dt: number, foods: Food[], trail: TrailSystem): number {
    let foodDelivered = 0

    // Queen update
    this.queen.update(dt)

    // Egg laying
    if (this.queen.isAlive()) {
      this.eggTimer -= dt
      if (this.eggTimer <= 0) {
        this.eggTimer = EGG_LAY_INTERVAL
        // Lay egg near queen
        const ox = (Math.random() - 0.5) * 6
        const oz = (Math.random() - 0.5) * 6
        this.eggs.push(new Egg(this.scene, this.queen.position.x + ox, this.queen.position.y + 0.5, this.queen.position.z + oz))
      }
    }

    // Update eggs
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      if (this.eggs[i].update(dt)) {
        // Hatch! Spawn ally ant near queen, then it walks to surface
        const egg = this.eggs[i]
        this.allies.push(new AllyAnt(
          this.scene, this.terrain,
          egg.position.x, egg.position.y, egg.position.z,
          new Vector3(this.nestX, this.entranceY, this.nestZ),
          this.isEnemy,
        ))
        egg.dispose()
        this.eggs.splice(i, 1)
      }
    }

    // Update ally ants
    const queenPos = this.queen.position
    for (const ally of this.allies) {
      const wasDel = ally.isDeliveringFood()
      ally.update(dt, foods, queenPos, trail)
      // Check if this ant just delivered food
      if (wasDel && ally.justDelivered(queenPos)) {
        this.queen.feedFood(10)
        this.score += 10
        foodDelivered++
      }
    }

    return foodDelivered
  }

  dispose(): void {
    this.queen.dispose()
    for (const egg of this.eggs) egg.dispose()
    for (const ally of this.allies) ally.dispose()
    this.eggs.length = 0
    this.allies.length = 0
  }
}
