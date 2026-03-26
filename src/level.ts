import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
} from '@babylonjs/core'
import type { EnemyType } from './enemy'

/** Seeded PRNG (mulberry32) so levels are reproducible per round */
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

export interface LevelData {
  flagX: number
  flagZ: number
  enemySpawns: { x: number; z: number; type: EnemyType }[]
  playerSpawnX: number
  playerSpawnZ: number
}

/**
 * Pick an enemy type based on round-driven probabilities.
 * Early rounds: mostly normal. Higher rounds introduce varied types.
 */
function pickEnemyType(round: number, rng: () => number): EnemyType {
  const r = rng()
  if (round <= 2) return 'normal'

  // Progressive difficulty: more types unlocked at higher rounds
  const shooterChance = Math.min(0.20, (round - 2) * 0.04)
  const flyerChance   = Math.min(0.15, (round - 3) * 0.03)
  const giantChance   = Math.min(0.12, (round - 3) * 0.03)
  const speedChance   = Math.min(0.18, (round - 2) * 0.04)

  if (r < shooterChance) return 'shooter'
  if (r < shooterChance + flyerChance) return 'flyer'
  if (r < shooterChance + flyerChance + giantChance) return 'giant'
  if (r < shooterChance + flyerChance + giantChance + speedChance) return 'speedster'
  return 'normal'
}

/**
 * Generate a level layout for the given round.
 * Player spawns on the opposite side of the map from the flag.
 * Enemies are scattered between the player and the flag.
 */
export function generateLevel(round: number, worldMinX: number, worldMaxX: number, worldMinZ: number, worldMaxZ: number): LevelData {
  const rng = mulberry32(round * 7919 + 1337)

  const margin = 6
  const minX = worldMinX + margin
  const maxX = worldMaxX - margin
  const minZ = worldMinZ + margin
  const maxZ = worldMaxZ - margin
  const rangeX = maxX - minX
  const rangeZ = maxZ - minZ

  // Flag spawns in a random quadrant at ~70-90% of map distance from center
  const quadrant = Math.floor(rng() * 4)
  const flagDist = 0.7 + rng() * 0.2
  let flagX: number, flagZ: number
  switch (quadrant) {
    case 0: flagX = minX + rangeX * flagDist; flagZ = minZ + rangeZ * flagDist; break
    case 1: flagX = minX + rangeX * (1 - flagDist); flagZ = minZ + rangeZ * flagDist; break
    case 2: flagX = minX + rangeX * flagDist; flagZ = minZ + rangeZ * (1 - flagDist); break
    default: flagX = minX + rangeX * (1 - flagDist); flagZ = minZ + rangeZ * (1 - flagDist); break
  }

  // Player spawns on the opposite side of the map from the flag
  const cx = (minX + maxX) / 2
  const cz = (minZ + maxZ) / 2
  const playerSpawnX = cx - (flagX - cx)
  const playerSpawnZ = cz - (flagZ - cz)

  // Enemy spawns — between player and flag, progressive count
  const enemyCount = 3 + round * 2
  const enemySpawns: { x: number; z: number; type: EnemyType }[] = []
  for (let i = 0; i < enemyCount; i++) {
    // Place along the corridor between player and flag with lateral spread
    const t = 0.15 + rng() * 0.7 // 15-85% along the path
    const baseX = playerSpawnX + (flagX - playerSpawnX) * t
    const baseZ = playerSpawnZ + (flagZ - playerSpawnZ) * t
    // Add lateral spread perpendicular to the path
    const spread = 15 + rng() * 20
    const angle = rng() * Math.PI * 2
    const ex = Math.max(minX, Math.min(maxX, baseX + Math.cos(angle) * spread))
    const ez = Math.max(minZ, Math.min(maxZ, baseZ + Math.sin(angle) * spread))
    const type = pickEnemyType(round, rng)
    enemySpawns.push({ x: ex, z: ez, type })
  }

  return { flagX, flagZ, enemySpawns, playerSpawnX, playerSpawnZ }
}

/**
 * Create the red flag mesh.
 */
export function createFlag(scene: Scene, x: number, z: number, surfaceY: number): Mesh {
  // Pole
  const pole = MeshBuilder.CreateCylinder('flagPole', { height: 6, diameter: 0.2 }, scene)
  pole.position.set(x, surfaceY + 3, z)
  const poleMat = new StandardMaterial('poleMat', scene)
  poleMat.diffuseColor = new Color3(0.6, 0.6, 0.6)
  pole.material = poleMat

  // Flag cloth — a flat box
  const flag = MeshBuilder.CreateBox('flagCloth', { width: 2.5, height: 1.5, depth: 0.05 }, scene)
  flag.position.set(x + 1.25, surfaceY + 5.25, z)
  const flagMat = new StandardMaterial('flagMat', scene)
  flagMat.diffuseColor = new Color3(0.9, 0.1, 0.1)
  flagMat.emissiveColor = new Color3(0.3, 0.02, 0.02)
  flag.material = flagMat

  // Base ring
  const base = MeshBuilder.CreateTorus('flagBase', { diameter: 1.5, thickness: 0.3, tessellation: 16 }, scene)
  base.position.set(x, surfaceY + 0.15, z)
  const baseMat = new StandardMaterial('flagBaseMat', scene)
  baseMat.diffuseColor = new Color3(0.9, 0.85, 0.1)
  baseMat.emissiveColor = new Color3(0.2, 0.18, 0.0)
  base.material = baseMat

  // Group under a parent for easy disposal
  const parent = new Mesh('flagGroup', scene)
  pole.parent = parent
  flag.parent = parent
  base.parent = parent

  return parent
}
