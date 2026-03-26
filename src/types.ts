/** Animation states for the ant player */
export type AnimState = 'idle' | 'walk' | 'jump' | 'fall'

/** Player state synced over the network */
export interface PlayerState {
  x: number
  y: number
  z: number
  ry: number
  anim: AnimState
}

/** Dig event synced over the network */
export interface DigEvent {
  x: number
  y: number
  z: number
}

/** Enemy position for network sync */
export interface EnemyNetState {
  x: number; y: number; z: number; ry: number
  chasing: boolean
}

/** Compact NPC position for network sync */
export interface NpcNetState {
  x: number; y: number; z: number; ry: number
}

/** Network message envelope */
export type NetMessage =
  | { type: 'state'; state: PlayerState }
  | { type: 'dig'; dig: DigEvent }
  | { type: 'round'; round: number }
  | { type: 'caught' }
  | { type: 'npcs'; enemies: NpcNetState[]; critters: NpcNetState[] }
