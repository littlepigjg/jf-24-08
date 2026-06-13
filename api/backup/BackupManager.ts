import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorageAdapter } from './StorageAdapter.js'
import { backupIndex } from './BackupIndex.js'
import { RetentionManager } from './RetentionManager.js'
import {
  computeSha256,
  computeFileSha256,
  generateBackupId,
  computeChainHash,
  formatTimestamp,
  formatDatePath,
} from './crypto.js'
import type {
  BackupFileInfo,
  BackupManifest,
  BackupRecord,
  BackupType,
  IncrementalDiff,
  StorageConfig,
  BackupStats,
} from './types.js'
import { createStorageAdapter } from './StorageAdapter.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const DATA_FILES = ['qrcodes.json', 'scans.json', 'batches.json']

export class BackupManager {
  private storageAdapter: StorageAdapter | null = null
  private storageConfig: StorageConfig
  private retentionManager: RetentionManager
  private initialized = false
  private backupInProgress = false

  constructor(storageConfig: StorageConfig, retentionPolicy?: Partial<typeof RetentionManager.prototype.getPolicy extends () => infer R ? R : never>) {
    this.storageConfig = storageConfig
    this.retentionManager = new RetentionManager(retentionPolicy as any)
  }

  async init(): Promise<void> {
    if (this.initialized) return
    this.storageAdapter = await createStorageAdapter(this.storageConfig)
    await backupIndex.init()
    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized || !this.storageAdapter) {
      throw new Error('BackupManager not initialized. Call init() first.')
    }
  }

  private getStorageAdapter(): StorageAdapter {
    this.ensureInitialized()
    return this.storageAdapter!
  }

  async getDataFiles(): Promise<BackupFileInfo[]> {
    const files: BackupFileInfo[] = []
    for (const fileName of DATA_FILES) {
      const filePath = path.join(DATA_DIR, fileName)
      try {
        const stat = await fs.stat(filePath)
        const sha256 = await computeFileSha256(filePath)
        files.push({
          fileName,
          filePath,
          size: stat.size,
          sha256,
        })
      } catch {
        continue
      }
    }
    return files
  }

  private async computeIncrementalDiffs(
    currentFiles: BackupFileInfo[],
    parentManifest: BackupManifest | null,
  ): Promise<IncrementalDiff[]> {
    const diffs: IncrementalDiff[] = []
    const parentFiles = new Map(parentManifest?.files.map((f) => [f.fileName, f]) || [])
    const currentFileNames = new Set(currentFiles.map((f) => f.fileName))

    for (const current of currentFiles) {
      const parent = parentFiles.get(current.fileName)
      if (!parent) {
        diffs.push({
          fileName: current.fileName,
          operation: 'add',
          newSha256: current.sha256,
        })
      } else if (parent.sha256 !== current.sha256) {
        diffs.push({
          fileName: current.fileName,
          operation: 'modify',
          oldSha256: parent.sha256,
          newSha256: current.sha256,
        })
      }
    }

    for (const [fileName, parent] of parentFiles) {
      if (!currentFileNames.has(fileName)) {
        diffs.push({
          fileName,
          operation: 'delete',
          oldSha256: parent.sha256,
        })
      }
    }

    return diffs
  }

  private async uploadFiles(
    backupId: string,
    backupType: BackupType,
    files: BackupFileInfo[],
    diffs?: IncrementalDiff[],
  ): Promise<void> {
    const adapter = this.getStorageAdapter()
    const datePath = formatDatePath()
    const timestamp = formatTimestamp()

    const filesToUpload = backupType === 'full'
      ? files
      : files.filter((f) => diffs?.some((d) => d.fileName === f.fileName && (d.operation === 'add' || d.operation === 'modify')))

    for (const file of filesToUpload) {
      const data = await fs.readFile(file.filePath)
      const key = `backups/${backupType}/${datePath}/${backupId}/${file.fileName}`
      await adapter.upload(key, data)
    }
  }

  private async uploadManifest(backupId: string, backupType: BackupType, manifest: BackupManifest): Promise<void> {
    const adapter = this.getStorageAdapter()
    const datePath = formatDatePath()
    const manifestKey = `backups/${backupType}/${datePath}/${backupId}/manifest.json`
    await adapter.upload(manifestKey, JSON.stringify(manifest, null, 2))
  }

  async getManifest(backupId: string, record: BackupRecord): Promise<BackupManifest> {
    const adapter = this.getStorageAdapter()
    const manifestData = await adapter.downloadAsString(record.manifestPath)
    return JSON.parse(manifestData) as BackupManifest
  }

  async createFullBackup(metadata: Record<string, unknown> = {}): Promise<BackupRecord> {
    if (this.backupInProgress) {
      throw new Error('A backup is already in progress')
    }

    this.backupInProgress = true
    let pendingRecord: BackupRecord | undefined

    try {
      this.ensureInitialized()
      const backupId = generateBackupId()
      const timestamp = new Date().toISOString()
      const datePath = formatDatePath(new Date(timestamp))

      pendingRecord = {
        id: backupId,
        type: 'full',
        status: 'running',
        timestamp,
        totalSize: 0,
        fileCount: 0,
        manifestPath: `backups/full/${datePath}/${backupId}/manifest.json`,
        storageType: this.storageConfig.type,
        verified: false,
      }
      await backupIndex.addRecord(pendingRecord)

      const files = await this.getDataFiles()
      const fileContent = files.map((f) => `${f.fileName}:${f.sha256}`).join('|')
      const previousChainHash = backupIndex.getLastChainHash()
      const chainHash = computeChainHash(previousChainHash, fileContent)

      const manifest: BackupManifest = {
        backupId,
        backupType: 'full',
        timestamp,
        files,
        totalSize: files.reduce((sum, f) => sum + f.size, 0),
        sha256Chain: chainHash,
        metadata,
      }

      await this.uploadFiles(backupId, 'full', files)
      await this.uploadManifest(backupId, 'full', manifest)

      backupIndex.setLastChainHash(chainHash)

      const finalRecord = await backupIndex.updateRecord(backupId, {
        status: 'completed',
        totalSize: manifest.totalSize,
        fileCount: files.length,
      })

      if (this.storageConfig.type === 'local') {
        await this.cleanupOldBackups()
      }

      return finalRecord!
    } catch (error) {
      await backupIndex.updateRecord(pendingRecord!.id, {
        status: 'failed',
        errorMessage: (error as Error).message,
      })
      throw error
    } finally {
      this.backupInProgress = false
    }
  }

  async createIncrementalBackup(metadata: Record<string, unknown> = {}): Promise<BackupRecord> {
    if (this.backupInProgress) {
      throw new Error('A backup is already in progress')
    }

    this.backupInProgress = true
    let pendingRecord: BackupRecord | undefined

    try {
      this.ensureInitialized()

      const latestFull = backupIndex.getLatestFullBackup()
      if (!latestFull) {
        return this.createFullBackup(metadata)
      }

      const latestFullManifest = await this.getManifest(latestFull.id, latestFull)

      const backupId = generateBackupId()
      const timestamp = new Date().toISOString()
      const datePath = formatDatePath(new Date(timestamp))

      pendingRecord = {
        id: backupId,
        type: 'incremental',
        status: 'running',
        timestamp,
        parentId: latestFull.id,
        totalSize: 0,
        fileCount: 0,
        manifestPath: `backups/incremental/${datePath}/${backupId}/manifest.json`,
        storageType: this.storageConfig.type,
        verified: false,
      }
      await backupIndex.addRecord(pendingRecord)

      const currentFiles = await this.getDataFiles()
      const diffs = await this.computeIncrementalDiffs(currentFiles, latestFullManifest)

      if (diffs.length === 0) {
        await backupIndex.updateRecord(backupId, {
          status: 'completed',
          totalSize: 0,
          fileCount: 0,
        })
        return backupIndex.getById(backupId)!
      }

      const diffContent = diffs.map((d) => `${d.fileName}:${d.operation}:${d.oldSha256 || ''}:${d.newSha256 || ''}`).join('|')
      const previousChainHash = backupIndex.getLastChainHash()
      const chainHash = computeChainHash(previousChainHash, diffContent)

      const manifest: BackupManifest = {
        backupId,
        backupType: 'incremental',
        timestamp,
        parentBackupId: latestFull.id,
        files: currentFiles,
        incrementalDiffs: diffs,
        totalSize: currentFiles
          .filter((f) => diffs.some((d) => d.fileName === f.fileName && (d.operation === 'add' || d.operation === 'modify')))
          .reduce((sum, f) => sum + f.size, 0),
        sha256Chain: chainHash,
        metadata,
      }

      await this.uploadFiles(backupId, 'incremental', currentFiles, diffs)
      await this.uploadManifest(backupId, 'incremental', manifest)

      backupIndex.setLastChainHash(chainHash)

      const finalRecord = await backupIndex.updateRecord(backupId, {
        status: 'completed',
        totalSize: manifest.totalSize,
        fileCount: diffs.length,
      })

      if (this.storageConfig.type === 'local') {
        await this.cleanupOldBackups()
      }

      return finalRecord!
    } catch (error) {
      if (pendingRecord) {
        await backupIndex.updateRecord(pendingRecord.id, {
          status: 'failed',
          errorMessage: (error as Error).message,
        })
      }
      throw error
    } finally {
      this.backupInProgress = false
    }
  }

  async cleanupOldBackups(): Promise<string[]> {
    this.ensureInitialized()
    const adapter = this.getStorageAdapter()
    const allRecords = backupIndex.getAll()
    const toDelete = this.retentionManager.getBackupsToDelete(allRecords)
    const deleted: string[] = []

    for (const backupId of toDelete) {
      const record = backupIndex.getById(backupId)
      if (!record) continue

      try {
        const manifest = await this.getManifest(backupId, record)
        const datePath = formatDatePath(new Date(record.timestamp))
        const backupPrefix = `backups/${record.type}/${datePath}/${backupId}`
        const keys = await adapter.list(backupPrefix)
        for (const key of keys) {
          await adapter.delete(key)
        }
        await backupIndex.deleteRecord(backupId)
        deleted.push(backupId)
      } catch {
        continue
      }
    }

    return deleted
  }

  getStats(): BackupStats {
    const all = backupIndex.getAll()
    const completed = all.filter((r) => r.status === 'completed')
    const lastBackup = completed[0]
    const now = new Date()
    const nextFull = new Date(now)
    nextFull.setHours(2, 0, 0, 0)
    if (nextFull <= now) nextFull.setDate(nextFull.getDate() + 1)

    const nextIncremental = new Date(now)
    nextIncremental.setMinutes(0, 0, 0)
    nextIncremental.setHours(nextIncremental.getHours() + 1)

    return {
      totalBackups: completed.length,
      fullBackups: completed.filter((r) => r.type === 'full').length,
      incrementalBackups: completed.filter((r) => r.type === 'incremental').length,
      totalSize: completed.reduce((sum, r) => sum + r.totalSize, 0),
      lastBackupTime: lastBackup?.timestamp,
      lastBackupStatus: lastBackup?.status,
      nextFullBackupTime: nextFull.toISOString(),
      nextIncrementalBackupTime: nextIncremental.toISOString(),
    }
  }

  listBackups(): BackupRecord[] {
    return backupIndex.getAll()
  }

  getBackupById(id: string): BackupRecord | undefined {
    return backupIndex.getById(id)
  }

  isBackupRunning(): boolean {
    return this.backupInProgress
  }

  updateRetentionPolicy(policy: Partial<ReturnType<RetentionManager['getPolicy']>>): void {
    this.retentionManager.updatePolicy(policy)
  }

  getRetentionPolicy() {
    return this.retentionManager.getPolicy()
  }
}
