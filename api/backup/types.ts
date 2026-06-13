export type BackupType = 'full' | 'incremental'

export type BackupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'corrupted'

export type RestoreStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dry_run'

export type StorageType = 'local' | 's3'

export interface BackupFileInfo {
  fileName: string
  filePath: string
  size: number
  sha256: string
}

export interface IncrementalDiff {
  fileName: string
  operation: 'add' | 'modify' | 'delete'
  oldSha256?: string
  newSha256?: string
  patch?: string
}

export interface BackupManifest {
  backupId: string
  backupType: BackupType
  timestamp: string
  parentBackupId?: string
  files: BackupFileInfo[]
  incrementalDiffs?: IncrementalDiff[]
  totalSize: number
  sha256Chain: string
  metadata: Record<string, unknown>
}

export interface BackupRecord {
  id: string
  type: BackupType
  status: BackupStatus
  timestamp: string
  parentId?: string
  totalSize: number
  fileCount: number
  manifestPath: string
  storageType: StorageType
  errorMessage?: string
  verified: boolean
  verificationTime?: string
}

export interface RetentionPolicy {
  keepDailyBackups: number
  keepHourlyBackups: number
  keepWeeklyBackups: number
  keepMonthlyBackups: number
  minBackupAgeDays: number
}

export interface BackupScheduleConfig {
  enabled: boolean
  fullBackupCron: string
  incrementalBackupCron: string
  retention: RetentionPolicy
  autoCleanup: boolean
}

export interface VerifyResult {
  backupId: string
  valid: boolean
  timestamp: string
  fileChecks: {
    fileName: string
    expectedSha256: string
    actualSha256: string
    valid: boolean
  }[]
  chainValid: boolean
  errorMessage?: string
}

export interface RestoreResult {
  backupId: string
  status: RestoreStatus
  timestamp: string
  restoredFiles: string[]
  targetPath?: string
  dryRun: boolean
  errorMessage?: string
  durationMs: number
}

export interface BackupStats {
  totalBackups: number
  fullBackups: number
  incrementalBackups: number
  totalSize: number
  lastBackupTime?: string
  lastBackupStatus?: BackupStatus
  nextFullBackupTime?: string
  nextIncrementalBackupTime?: string
}

export interface StorageConfig {
  type: StorageType
  local?: {
    basePath: string
  }
  s3?: {
    endpoint: string
    bucket: string
    accessKeyId: string
    secretAccessKey: string
    region: string
    prefix?: string
  }
}
