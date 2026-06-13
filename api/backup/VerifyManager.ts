import type { StorageAdapter } from './StorageAdapter.js'
import { backupIndex } from './BackupIndex.js'
import type {
  BackupManifest,
  BackupRecord,
  VerifyResult,
} from './types.js'
import { BackupManager } from './BackupManager.js'
import { computeSha256, computeChainHash } from './crypto.js'

export class VerifyManager {
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
      throw new Error('VerifyManager not initialized. Call init() first.')
    }
  }

  private async getManifest(record: BackupRecord): Promise<BackupManifest> {
    return this.backupManager.getManifest(record.id, record)
  }

  private async downloadFile(
    backupId: string,
    backupType: 'full' | 'incremental',
    timestamp: string,
    fileName: string,
  ): Promise<Buffer> {
    const date = new Date(timestamp)
    const datePath = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
    const key = `backups/${backupType}/${datePath}/${backupId}/${fileName}`
    return this.storageAdapter.download(key)
  }

  async verifyBackup(backupId: string): Promise<VerifyResult> {
    this.ensureInitialized()
    const record = backupIndex.getById(backupId)

    if (!record) {
      return {
        backupId,
        valid: false,
        timestamp: new Date().toISOString(),
        fileChecks: [],
        chainValid: false,
        errorMessage: 'Backup record not found',
      }
    }

    if (record.status !== 'completed') {
      return {
        backupId,
        valid: false,
        timestamp: new Date().toISOString(),
        fileChecks: [],
        chainValid: false,
        errorMessage: `Backup status is ${record.status}, expected completed`,
      }
    }

    try {
      const manifest = await this.getManifest(record)
      const fileChecks: VerifyResult['fileChecks'] = []

      if (record.type === 'full') {
        for (const file of manifest.files) {
          try {
            const data = await this.downloadFile(record.id, 'full', record.timestamp, file.fileName)
            const actualSha256 = computeSha256(data)
            fileChecks.push({
              fileName: file.fileName,
              expectedSha256: file.sha256,
              actualSha256,
              valid: file.sha256 === actualSha256,
            })
          } catch (error) {
            fileChecks.push({
              fileName: file.fileName,
              expectedSha256: file.sha256,
              actualSha256: '',
              valid: false,
            })
          }
        }
      } else if (record.type === 'incremental' && manifest.incrementalDiffs) {
        for (const diff of manifest.incrementalDiffs) {
          if (diff.operation === 'add' || diff.operation === 'modify') {
            try {
              const data = await this.downloadFile(record.id, 'incremental', record.timestamp, diff.fileName)
              const actualSha256 = computeSha256(data)
              fileChecks.push({
                fileName: diff.fileName,
                expectedSha256: diff.newSha256 || '',
                actualSha256,
                valid: diff.newSha256 === actualSha256,
              })
            } catch {
              fileChecks.push({
                fileName: diff.fileName,
                expectedSha256: diff.newSha256 || '',
                actualSha256: '',
                valid: false,
              })
            }
          }
        }
      }

      const allFilesValid = fileChecks.every((fc) => fc.valid)
      let chainValid = true

      const chain = backupIndex.getBackupChain(backupId)
      let previousHash = ''

      for (let i = 0; i < chain.length; i++) {
        const chainRecord = chain[i]
        const chainManifest = await this.getManifest(chainRecord)

        let content = ''
        if (chainRecord.type === 'full') {
          content = chainManifest.files.map((f) => `${f.fileName}:${f.sha256}`).join('|')
        } else if (chainRecord.type === 'incremental' && chainManifest.incrementalDiffs) {
          content = chainManifest.incrementalDiffs
            .map((d) => `${d.fileName}:${d.operation}:${d.oldSha256 || ''}:${d.newSha256 || ''}`)
            .join('|')
        }

        const expectedChainHash = computeChainHash(previousHash, content)
        if (expectedChainHash !== chainManifest.sha256Chain) {
          chainValid = false
          break
        }
        previousHash = chainManifest.sha256Chain
      }

      const valid = allFilesValid && chainValid

      await backupIndex.updateRecord(backupId, {
        verified: true,
        verificationTime: new Date().toISOString(),
        status: valid ? record.status : 'corrupted',
      })

      return {
        backupId,
        valid,
        timestamp: new Date().toISOString(),
        fileChecks,
        chainValid,
      }
    } catch (error) {
      return {
        backupId,
        valid: false,
        timestamp: new Date().toISOString(),
        fileChecks: [],
        chainValid: false,
        errorMessage: (error as Error).message,
      }
    }
  }

  async verifyAllBackups(): Promise<VerifyResult[]> {
    this.ensureInitialized()
    const completed = backupIndex.getAll().filter((r) => r.status === 'completed')
    const results: VerifyResult[] = []

    for (const record of completed) {
      const result = await this.verifyBackup(record.id)
      results.push(result)
    }

    return results
  }

  async verifyLatest(): Promise<VerifyResult | null> {
    this.ensureInitialized()
    const latest = backupIndex.getLatestBackup()
    if (!latest) return null
    return this.verifyBackup(latest.id)
  }
}
