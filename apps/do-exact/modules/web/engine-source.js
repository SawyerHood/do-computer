// The page host serves modules unchanged. build.mjs bundles only these foreign dependencies.
export * as THREE from '../../../web/node_modules/three/build/three.module.js';
export { AgentOrbCore } from '../../../../packages/mascot/src/orb-core.js';
export { AgentOrbWardrobe } from '../../../../packages/mascot/src/wardrobe.js';
export { AgentOrbSky } from '../../../../packages/mascot/src/sky.js';
export { AgentOrbPortrait } from '../../../../packages/mascot/src/portrait.js';
export { avatarLook } from '../../../../packages/protocol/src/avatars.ts';
export { avatarSvg } from '../../../../packages/protocol/src/avatar-svg.ts';
export { RARITIES, wearItem } from '../../../../packages/protocol/src/wardrobe.ts';
