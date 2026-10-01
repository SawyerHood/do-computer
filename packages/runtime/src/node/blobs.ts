import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { BlobMetadata, BlobObject, BlobStore } from "../index.ts"

const META_SUFFIX = ".meta.json"

/** One path segment per key segment, encoded so no key can leave the root or collide with metadata. */
function encodeKey(key: string): string {
  return key
    .split("/")
    .map((segment) => {
      const encoded = encodeURIComponent(segment).replaceAll(".", "%2E")
      return encoded === "" ? "%00" : encoded
    })
    .join("/")
}

function decodeKey(path: string): string {
  return path
    .split("/")
    .map((segment) => (segment === "%00" ? "" : decodeURIComponent(segment)))
    .join("/")
}

/** `BlobStore` over a local directory. Metadata lives in a sidecar file next to each object. */
export class FileBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private path(key: string): string {
    return join(this.root, encodeKey(key))
  }

  async put(key: string, data: Uint8Array, metadata?: BlobMetadata): Promise<void> {
    const path = this.path(key)
    await mkdir(dirname(path), { recursive: true })
    // Write then rename, so a reader never sees a half-written object.
    const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(temporary, data)
    await rename(temporary, path)
    await writeFile(path + META_SUFFIX, JSON.stringify({ contentType: metadata?.contentType }))
  }

  async head(key: string): Promise<BlobObject | undefined> {
    const path = this.path(key)
    try {
      const info = await stat(path)
      if (!info.isFile()) return undefined
      let contentType: string | undefined
      try {
        contentType = JSON.parse(await readFile(path + META_SUFFIX, "utf8")).contentType
      } catch {
        // An object without metadata is still an object.
      }
      return { key, size: info.size, contentType, uploadedAt: info.mtimeMs }
    } catch {
      return undefined
    }
  }

  async get(key: string) {
    const object = await this.head(key)
    if (object === undefined) return undefined
    return { ...object, bytes: async () => new Uint8Array(await readFile(this.path(key))) }
  }

  async delete(key: string): Promise<void> {
    const path = this.path(key)
    await rm(path, { force: true })
    await rm(path + META_SUFFIX, { force: true })
  }

  async list(prefix: string): Promise<BlobObject[]> {
    const objects: BlobObject[] = []
    let names: string[]
    try {
      names = await readdir(this.root, { recursive: true })
    } catch {
      return objects
    }
    for (const name of names) {
      if (name.endsWith(META_SUFFIX) || name.endsWith(".tmp")) continue
      const key = decodeKey(name.split("\\").join("/"))
      if (!key.startsWith(prefix)) continue
      const object = await this.head(key)
      if (object !== undefined) objects.push(object)
    }
    return objects.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }
}
