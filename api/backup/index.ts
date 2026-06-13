import type { StorageConfig } from './types.js'
import { BackupManager } from './BackupManager.js'
import { RestoreManager } from './RestoreManager.js'
import { VerifyManager } from './VerifyManager.js'
import { BackupScheduler, DEFAULT_SCHEDULE_CONFIG } from './BackupScheduler.js'

function getStorageConfig(): StorageConfig {
  const type = (process.env.BACKUP_STORAGE_TYPE as StorageConfig['type']) || 'local'

  if (type === 's3') {
    return {
      type: 's3',
      s3: {
        endpoint: process.env.BACKUP_S3_ENDPOINT || '',
        bucket: process.env.BACKUP_S3_BUCKET || '',
        accessKeyId: process.env.BACKUP_S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.BACKUP_S3_SECRET_ACCESS_KEY || '',
        region: process.env.BACKUP_S3_REGION || 'us-east-1',
        prefix: process.env.BACKUP_S3_PREFIX,
      },
    }
  }

  return {
    type: 'local',
    local: {
      basePath: process.env.BACKUP_LOCAL_PATH || '',
    },
  }
}

export const backupManager = new BackupManager(getStorageConfig())
export const restoreManager = new RestoreManager(backupManager)
export const verifyManager = new VerifyManager(backupManager)
export const backupScheduler = new BackupScheduler(backupManager, DEFAULT_SCHEDULE_CONFIG)

let initialized = false

export async function initBackupService(): Promise<void> {
  if (initialized) return
  await backupManager.init()
  await restoreManager.init()
  await verifyManager.init()

  if (process.env.BACKUP_AUTO_START !== 'false') {
    backupScheduler.start()
  }

  initialized = true
}
