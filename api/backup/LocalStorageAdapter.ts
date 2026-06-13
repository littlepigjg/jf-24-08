import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorageAdapter } from './StorageAdapter.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export class LocalStorageAdapter implements StorageAdapter {
  readonly type = 'local'
  private basePath: string

  constructor(basePath?: string) {
    this.basePath = basePath || path.resolve(__dirname, '..', '..', 'backups')
  }

  private resolveKey(key: string): string {
    const normalizedKey = key.replace(/^\/+/, '')
    return path.join(this.basePath, normalizedKey)
  }

  private async ensureDir(filePath: string): Promise<void> {
    const dir = path.dirname(filePath)
    await fs.mkdir(dir, { recursive: true })
  }

  async upload(key: string, data: Buffer | string): Promise<void> {
    const filePath = this.resolveKey(key)
    await this.ensureDir(filePath)
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    await fs.writeFile(filePath, buffer)
  }

  async download(key: string): Promise<Buffer> {
    const filePath = this.resolveKey(key)
    return await fs.readFile(filePath)
  }

  async downloadAsString(key: string): Promise<string> {
    const buffer = await this.download(key)
    return buffer.toString('utf-8')
  }

  async exists(key: string): Promise<boolean> {
    try {
      const filePath = this.resolveKey(key)
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const filePath = this.resolveKey(key)
      const stat = await fs.stat(filePath)
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true, force: true })
      } else {
        await fs.unlink(filePath)
      }
    } catch {
      // ignore if not exists
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const dirPath = this.resolveKey(prefix || '')
    const results: string[] = []

    async function walk(dir: string, basePrefix: string): Promise<void> {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true })
        for (const entry of entries) {
          const relativePath = basePrefix ? `${basePrefix}/${entry.name}` : entry.name
          const fullPath = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            await walk(fullPath, relativePath)
          } else {
            results.push(relativePath)
          }
        }
      } catch {
        // directory may not exist
      }
    }

    try {
      const stat = await fs.stat(dirPath)
      if (stat.isDirectory()) {
        await walk(dirPath, '')
      }
    } catch {
      // directory does not exist
    }

    return results.sort()
  }

  async getSize(key: string): Promise<number> {
    const filePath = this.resolveKey(key)
    const stat = await fs.stat(filePath)
    return stat.size
  }
}
