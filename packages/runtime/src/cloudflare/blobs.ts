import type { BlobMetadata, BlobObject, BlobRange, BlobStore } from "../index.ts"

function describe(object: R2Object): BlobObject {
  return {
    key: object.key,
    size: object.size,
    contentType: object.httpMetadata?.contentType,
    uploadedAt: object.uploaded.getTime(),
  }
}

/** `BlobStore` over an R2 bucket. `prefix` scopes every key, for example to one agent. */
export class R2BlobStore implements BlobStore {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly prefix = "",
  ) {}

  async put(key: string, data: Uint8Array, metadata?: BlobMetadata): Promise<void> {
    await this.bucket.put(this.prefix + key, data, {
      httpMetadata: metadata?.contentType ? { contentType: metadata.contentType } : undefined,
    })
  }

  async get(key: string, options?: { range?: BlobRange }) {
    const range = options?.range
    if (range === undefined) return this.read(await this.bucket.get(this.prefix + key))
    try {
      return this.read(await this.bucket.get(this.prefix + key, { range }))
    } catch (error) {
      // R2 refuses a part that has no byte of the object in it. Here that is an empty part.
      const whole = await this.bucket.head(this.prefix + key)
      if (whole === null || (range.offset < whole.size && range.length !== 0)) throw error
      return { ...this.strip(describe(whole)), bytes: async () => new Uint8Array(0) }
    }
  }

  private read(object: R2ObjectBody | null) {
    if (object === null) return undefined
    return {
      ...this.strip(describe(object)),
      bytes: async () => new Uint8Array(await object.arrayBuffer()),
    }
  }

  async head(key: string): Promise<BlobObject | undefined> {
    const object = await this.bucket.head(this.prefix + key)
    return object === null ? undefined : this.strip(describe(object))
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(this.prefix + key)
  }

  async list(prefix: string): Promise<BlobObject[]> {
    const objects: BlobObject[] = []
    let cursor: string | undefined
    do {
      const page = await this.bucket.list({
        prefix: this.prefix + prefix,
        cursor,
        include: ["httpMetadata"],
      })
      for (const object of page.objects) objects.push(this.strip(describe(object)))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor !== undefined)
    return objects
  }

  private strip(object: BlobObject): BlobObject {
    return { ...object, key: object.key.slice(this.prefix.length) }
  }
}
