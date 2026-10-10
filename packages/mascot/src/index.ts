/**
 * The creature every agent appears as: grown from a seed, in a color, and shown acting out what
 * the agent is doing. The drawing is `orb-core.js`, kept as plain JavaScript so that it runs the
 * same in a browser, in the Expo app and in the playground under `demo/`. `wardrobe.js`, beside
 * it and as plain, is what a creature can wear and the box a new thing comes in, and `sky.js`
 * is the sky a first egg comes down out of.
 */
export {
  AgentOrbCore,
  type MascotCore,
  type MascotState,
  type MascotVariant,
  type Orb,
  type OrbOptions,
} from "./orb-core.js"
export { AgentOrbWardrobe, type Gift, type Wardrobe, type WornOutfit } from "./wardrobe.js"
export { AgentOrbSky, type EggPlace, type Sky, type SkyCore } from "./sky.js"
