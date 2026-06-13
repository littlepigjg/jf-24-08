import type { StorageConfig } from './types.js'

export interface StorageAdapter {
  type: 'local' | 's3'

  upload(key: string, data: Buffer | string): Promise<void>
  download(key: string): Promise<Buffer>
  downloadAsString(key: string): Promise<string>
  exists(key: string): Promise<boolean>
  delete(key: string): Promise<void>
  list(prefix?: string): Promise<string[]>
  getSize(key: string): Promise<number>
}

export async function createStorageAdapter(
  config: StorageConfig,
): Promise<StorageAdapter> {
  if (config.type === 'local') {
    const { LocalStorageAdapter } = await import('./LocalStorageAdapter.js')
    return new LocalStorageAdapter(config.local?.basePath)
  }
  const { S3StorageAdapter } = await import('./S3StorageAdapter.js')
  return new S3StorageAdapter(config.s3!)
}
