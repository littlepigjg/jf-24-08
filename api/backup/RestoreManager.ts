import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StorageAdapter } from './StorageAdapter.js'
import { backupIndex } from './BackupIndex.js'
import type {
  BackupManifest,
  BackupRecord,
  RestoreResult,
} from './types.js'
import { BackupManager } from './BackupManager.js'
import { computeSha256 } from './crypto.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DATA_DIR = path.resolve(__dirname, '..', 'data')
const RESTORE_TEMP_DIR = path.resolve(__dirname, '..', '..', 'restore-temp')

export class RestoreManager {
  private backupManager: BackupManager
  private storageAdapter: StorageAdapter
  private initialized = false

  constructor(backupManager: BackupManager) {
    this.backupManager = backupManager
  }

  async init(): Promise<void> {
    if (this.initialized) return
    await this.backupManager.init()
    this.storageAdapter = (this.backupManager as any).getStorageAdapter()
    this.initialized = true
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RestoreManager not initialized. Call init() first.')
    }
  }

  private async getManifest(record: BackupRecord): Promise<BackupManifest> {
    return this.backupManager.getManifest(record.id, record)
  }

  findNearestBackup(targetTime: string | Date): BackupRecord | undefined {
    const target = new Date(targetTime).getTime()
    const completed = backupIndex
      .getAll()
      .filter((r) => r.status === 'completed')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

    let nearest: BackupRecord | undefined
    let minDiff = Infinity

    for (const record of completed) {
      const recordTime = new Date(record.timestamp).getTime()
      const diff = Math.abs(recordTime - target)
      if (diff < minDiff) {
        minDiff = diff
        nearest = record
      }
    }

    return nearest
  }

  private async buildRestoreState(backupId: string): Promise<Map<string, { manifest: BackupManifest; record: BackupRecord }>> {
    const chain = backupIndex.getBackupChain(backupId)
    const result = new Map<string, { manifest: BackupManifest; record: BackupRecord }>()

    for (const record of chain) {
      const manifest = await this.getManifest(record)
      result.set(record.id, { manifest, record })
    }

    return result
  }

  private async downloadFile(
    backupId: string,
    backupType: 'full' | 'incremental',
    timestamp: string,
    fileName: string,
  ): Promise<Buffer> {
    this.ensureInitialized()
    const date = new Date(timestamp)
    const datePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
    const key = `backups/${backupType}/${datePath}/${backupId}/${fileName}`
    return this.storageAdapter.download(key)
  }

  private async computeFinalState(backupId: string): Promise<Map<string, Buffer>> {
    const chain = backupIndex.getBackupChain(backupId)
    const fileStates = new Map<string, Buffer>()

    for (const record of chain) {
      const manifest = await this.getManifest(record)

      if (record.type === 'full') {
        fileStates.clear()
        for (const file of manifest.files) {
          const data = await this.downloadFile(record.id, 'full', record.timestamp, file.fileName)
          fileStates.set(file.fileName, data)
        }
      } else if (record.type === 'incremental' && manifest.incrementalDiffs) {
        for (const diff of manifest.incrementalDiffs) {
          if (diff.operation === 'add' || diff.operation === 'modify') {
            const data = await this.downloadFile(record.id, 'incremental', record.timestamp, diff.fileName)
            fileStates.set(diff.fileName, data)
          } else if (diff.operation === 'delete') {
            fileStates.delete(diff.fileName)
          }
        }
      }
    }

    return fileStates
  }

  async restoreToPointInTime(
    targetBackupId: string,
    options: {
      targetPath?: string
      dryRun?: boolean
    } = {},
  ): Promise<RestoreResult> {
    this.ensureInitialized()
    const startTime = Date.now()
    const targetRecord = backupIndex.getById(targetBackupId)

    if (!targetRecord) {
      return {
        backupId: targetBackupId,
        status: 'failed',
        timestamp: new Date().toISOString(),
        restoredFiles: [],
        dryRun: options.dryRun || false,
        errorMessage: 'Backup not found',
        durationMs: Date.now() - startTime,
      }
    }

    if (targetRecord.status !== 'completed') {
      return {
        backupId: targetBackupId,
        status: 'failed',
        timestamp: new Date().toISOString(),
        restoredFiles: [],
        dryRun: options.dryRun || false,
        errorMessage: `Backup status is ${targetRecord.status}, expected completed`,
        durationMs: Date.now() - startTime,
      }
    }

    try {
      const finalState = await this.computeFinalState(targetBackupId)
      const restoredFiles: string[] = []

      if (options.dryRun) {
        for (const [fileName, data] of finalState) {
          const expectedSha = targetRecord.type === 'full'
            ? (await this.getManifest(targetRecord)).files.find((f) => f.fileName === fileName)?.sha256
            : (await this.getManifest(targetRecord)).files.find((f) => f.fileName === fileName)?.sha256

          const actualSha = computeSha256(data)
          if (expectedSha && expectedSha !== actualSha) {
            throw new Error(`Integrity check failed for ${fileName}`)
          }
          restoredFiles.push(fileName)
        }

        return {
          backupId: targetBackupId,
          status: 'dry_run',
          timestamp: new Date().toISOString(),
          restoredFiles,
          dryRun: true,
          durationMs: Date.now() - startTime,
        }
      }

      const outputDir = options.targetPath || DATA_DIR

      if (options.targetPath) {
        await fs.mkdir(outputDir, { recursive: true })
      }

      for (const [fileName, data] of finalState) {
        const outputPath = path.join(outputDir, fileName)
        await fs.mkdir(path.dirname(outputPath), { recursive: true })
        await fs.writeFile(outputPath, data)
        restoredFiles.push(fileName)
      }

      return {
        backupId: targetBackupId,
        status: 'completed',
        timestamp: new Date().toISOString(),
        restoredFiles,
        targetPath: outputDir,
        dryRun: false,
        durationMs: Date.now() - startTime,
      }
    } catch (error) {
      return {
        backupId: targetBackupId,
        status: 'failed',
        timestamp: new Date().toISOString(),
        restoredFiles: [],
        dryRun: options.dryRun || false,
        errorMessage: (error as Error).message,
        durationMs: Date.now() - startTime,
      }
    }
  }

  async dryRunRestore(targetBackupId: string): Promise<RestoreResult> {
    return this.restoreToPointInTime(targetBackupId, { dryRun: true })
  }

  async restoreDrill(targetBackupId?: string): Promise<RestoreResult> {
    this.ensureInitialized()
    const backupId = targetBackupId || backupIndex.getLatestBackup()?.id

    if (!backupId) {
      return {
        backupId: 'unknown',
        status: 'failed',
        timestamp: new Date().toISOString(),
        restoredFiles: [],
        dryRun: true,
        errorMessage: 'No backups available for drill',
        durationMs: 0,
      }
    }

    await fs.mkdir(RESTORE_TEMP_DIR, { recursive: true })
    const drillDir = path.join(RESTORE_TEMP_DIR, `drill_${Date.now()}`)

    const result = await this.restoreToPointInTime(backupId, {
      targetPath: drillDir,
      dryRun: false,
    })

    try {
      await fs.rm(drillDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup errors
    }

    return {
      ...result,
      dryRun: true,
      status: result.status === 'completed' ? 'dry_run' : result.status,
      targetPath: undefined,
    }
  }

  async restoreLatest(): Promise<RestoreResult> {
    this.ensureInitialized()
    const latest = backupIndex.getLatestBackup()
    if (!latest) {
      return {
        backupId: 'unknown',
        status: 'failed',
        timestamp: new Date().toISOString(),
        restoredFiles: [],
        dryRun: false,
        errorMessage: 'No backups available',
        durationMs: 0,
      }
    }
    return this.restoreToPointInTime(latest.id)
  }
}
