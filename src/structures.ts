import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Mesh,
  Vector3,
} from '@babylonjs/core'
import type { Terrain } from './terrain'

/**
 * Create large environmental structures for the ant-scale world.
 * These are giant from the ant's perspective.
 */

/** 
 * Build a house corner — two massive walls meeting at a right angle.
 * This is gigantic compared to an ant.
 */
export function createHouseCorner(scene: Scene, terrain: Terrain, x: number, z: number): Mesh {
  const surfY = terrain.getSurfaceY(x, z)
  const wallHeight = 60   // tall wall
  const wallLength = 80   // long wall
  const wallThick = 4     // thick wall

  const parent = new Mesh('houseCorner', scene)

  // Wall 1 (along X axis)
  const wall1 = MeshBuilder.CreateBox('wall1', {
    width: wallLength, height: wallHeight, depth: wallThick,
  }, scene)
  wall1.position.set(x + wallLength / 2, surfY + wallHeight / 2, z)
  wall1.parent = parent

  // Wall 2 (along Z axis)
  const wall2 = MeshBuilder.CreateBox('wall2', {
    width: wallThick, height: wallHeight, depth: wallLength,
  }, scene)
  wall2.position.set(x, surfY + wallHeight / 2, z + wallLength / 2)
  wall2.parent = parent

  // Foundation slab
  const slab = MeshBuilder.CreateBox('slab', {
    width: wallLength + 8, height: 2, depth: wallLength + 8,
  }, scene)
  slab.position.set(x + wallLength / 2 - 4, surfY + 1, z + wallLength / 2 - 4)
  slab.parent = parent

  // Material — concrete/stucco look
  const wallMat = new StandardMaterial('wallMat', scene)
  wallMat.diffuseColor = new Color3(0.85, 0.82, 0.75)
  wallMat.specularColor = new Color3(0.1, 0.1, 0.1)
  wall1.material = wallMat
  wall2.material = wallMat

  const slabMat = new StandardMaterial('slabMat', scene)
  slabMat.diffuseColor = new Color3(0.65, 0.62, 0.58)
  slabMat.specularColor = new Color3(0.05, 0.05, 0.05)
  slab.material = slabMat

  // Mark the foundation area as solid in terrain so it can't be dug under
  terrain.addBox(x - 4, surfY - 3, z - 4, wallLength + 8, 3, wallLength + 8, 50)

  return parent
}

/**
 * Create a brick pathway — a flat strip of bricks that can't be dug through.
 * Runs between two points on the surface.
 */
export function createBrickPath(
  scene: Scene, terrain: Terrain,
  x1: number, z1: number, x2: number, z2: number,
  width = 12,
): Mesh {
  const parent = new Mesh('brickPath', scene)
  const dx = x2 - x1
  const dz = z2 - z1
  const length = Math.sqrt(dx * dx + dz * dz)
  const angle = Math.atan2(dx, dz)

  // Create brick segments
  const segLen = 6
  const segments = Math.ceil(length / segLen)

  const brickMat = new StandardMaterial('brickMat', scene)
  brickMat.diffuseColor = new Color3(0.72, 0.35, 0.25)
  brickMat.specularColor = new Color3(0.1, 0.05, 0.03)

  const mortarMat = new StandardMaterial('mortarMat', scene)
  mortarMat.diffuseColor = new Color3(0.6, 0.58, 0.54)

  for (let i = 0; i < segments; i++) {
    const t = (i + 0.5) / segments
    const bx = x1 + dx * t
    const bz = z1 + dz * t
    const surfY = terrain.getSurfaceY(bx, bz)

    const brick = MeshBuilder.CreateBox(`brick_${i}`, {
      width: width, height: 1.5, depth: segLen - 0.3,
    }, scene)
    brick.position.set(bx, surfY + 0.75, bz)
    brick.rotation.y = angle
    brick.material = brickMat
    brick.parent = parent
  }

  return parent
}

/**
 * Place all environmental structures in the world.
 */
export function buildEnvironment(scene: Scene, terrain: Terrain): Mesh[] {
  const structures: Mesh[] = []

  // House corner on one side of the map
  structures.push(createHouseCorner(scene, terrain, 100, 100))

  // Brick pathways (a few crossing the map)
  structures.push(createBrickPath(scene, terrain, -100, -50, 100, -50, 12))  // horizontal path
  structures.push(createBrickPath(scene, terrain, 50, -150, 50, 100, 10))    // vertical path
  structures.push(createBrickPath(scene, terrain, -200, 80, -50, 200, 8))    // diagonal path

  return structures
}
