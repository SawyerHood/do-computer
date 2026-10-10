/**
 * Where an agent's companion is on the desktop, and what its page is given. The companion is
 * the agent's creature in a small window with nothing behind it, kept over its owner's other
 * windows. The window shows a page of the deployment, `/desktop/pet`, which draws the creature
 * in one corner of it and what it says in the rest. The same types are written down for the
 * page in `apps/web/src/lib/pet.ts`; the two are kept alike by hand.
 */
import { onServer } from "./server.ts"

export type Point = { x: number; y: number }
export type Rect = Point & { width: number; height: number }
/** The corner of its window the creature is in. What it says takes the rest. */
export type Place = { x: "left" | "right"; y: "top" | "bottom" }

/** The side of the square the creature is given. */
export const BOX = 200
/** The window: the creature's square, and room beside it for a few lines of what it says. */
export const SIZE = { width: 340, height: 330 }
/** How far from the corner of the screen it starts. */
const MARGIN = 24

/** What the page is told as it loads. */
export type PetInfo = {
  /** The agent its owner chose for it, if they have chosen one. */
  agent?: string
  box: number
  place: Place
}

export type PetBridge = PetInfo & {
  onAgent(listener: (agentId: string) => void): void
  onPlace(listener: (place: Place) => void): void
  /** Where the pointer is on the screen, measured from the top left of the page. */
  onPointer(listener: (at: Point) => void): void
  /** Which agent the page is showing. */
  showing(agentId: string): void
  /** The parts of the window that are something. Clicks on the rest go to what is under it. */
  areas(rects: Rect[]): void
  /** It is picked up, to be carried with the pointer until it is put down. */
  drag(on: boolean): void
  /** Open the app on the agent, at one of its chats if given. */
  open(agentId: string, chatId?: string): void
  /** Show the menu of what can be done with it. */
  menu(): void
}

/** The names the app and the script the companion's window is given call each other by. */
export const PET = {
  info: "pet:info",
  agent: "pet:agent",
  place: "pet:place",
  pointer: "pet:pointer",
  showing: "pet:showing",
  areas: "pet:areas",
  drag: "pet:drag",
  open: "pet:open",
  menu: "pet:menu",
} as const

/** Where the creature's square is when nobody has put it anywhere: the bottom right of the screen. */
export function startAt(workArea: Rect): Point {
  return {
    x: workArea.x + workArea.width - BOX - MARGIN,
    y: workArea.y + workArea.height - BOX - MARGIN,
  }
}

/** The creature's square, moved no further than it takes to be wholly on a screen. */
export function keepOn(at: Point, workArea: Rect): Point {
  const within = (value: number, from: number, length: number) =>
    Math.round(Math.max(from, Math.min(value, from + Math.max(0, length - BOX))))
  return {
    x: within(at.x, workArea.x, workArea.width),
    y: within(at.y, workArea.y, workArea.height),
  }
}

/**
 * Which corner of its window the creature is in, for where it is on a screen. What it says is
 * above it where there is room above, as with anything that speaks, and reaches toward the
 * middle of the screen.
 */
export function placeOf(at: Point, workArea: Rect): Place {
  return {
    x: at.x + BOX / 2 >= workArea.x + workArea.width / 2 ? "right" : "left",
    y: at.y - workArea.y >= SIZE.height - BOX ? "bottom" : "top",
  }
}

/** The window that has the creature's square at a place on the screen, in a corner of it. */
export function boundsOf(at: Point, place: Place): Rect {
  return {
    x: place.x === "right" ? at.x - (SIZE.width - BOX) : at.x,
    y: place.y === "bottom" ? at.y - (SIZE.height - BOX) : at.y,
    ...SIZE,
  }
}

/** Whether a point is in any of some rectangles. */
export function inAny(point: Point, rects: readonly Rect[]): boolean {
  return rects.some(
    (rect) =>
      point.x >= rect.x &&
      point.x < rect.x + rect.width &&
      point.y >= rect.y &&
      point.y < rect.y + rect.height,
  )
}

/**
 * What a page said are the parts of its window that are something, as far as it can be
 * believed: a few rectangles, each inside the window.
 */
export function areasOf(said: unknown): Rect[] {
  if (!Array.isArray(said)) return []
  const rects: Rect[] = []
  for (const entry of said.slice(0, 8)) {
    const { x, y, width, height } = (entry ?? {}) as Partial<Rect>
    if (![x, y, width, height].every((value) => typeof value === "number" && isFinite(value))) {
      continue
    }
    const left = Math.max(0, Math.floor(x!))
    const top = Math.max(0, Math.floor(y!))
    const right = Math.min(SIZE.width, Math.ceil(x! + width!))
    const bottom = Math.min(SIZE.height, Math.ceil(y! + height!))
    if (right > left && bottom > top) {
      rects.push({ x: left, y: top, width: right - left, height: bottom - top })
    }
  }
  return rects
}

const PAGE = "/desktop/pet"

/** The address of the companion's page on a deployment. */
export const petAddress = (server: string): string => new URL(PAGE, server).href

/** Whether an address is the companion's page on the deployment the app is set to. */
export function isPetPage(address: string, server: string | undefined): boolean {
  if (server === undefined || !onServer(address, server)) return false
  return new URL(address).pathname === PAGE
}

/** A name of something of the deployment's, as it can be put in an address: an agent's, a chat's. */
export const isId = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value)

/** The page of an agent in the app, at one of its chats if given. */
export function agentAddress(server: string, agentId: string, chatId?: string): string {
  return new URL(`/a/${agentId}${chatId === undefined ? "" : `/c/${chatId}`}`, server).href
}
