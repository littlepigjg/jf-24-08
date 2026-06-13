export type QrCodeType = 'static' | 'dynamic'
export type ErrorLevel = 'L' | 'M' | 'Q' | 'H'
export type BatchStatus = 'pending' | 'running' | 'done' | 'failed'

export interface QrCode {
  id: string
  name: string
  type: QrCodeType
  targetUrl: string
  shortCode: string
  size: number
  foreground: string
  background: string
  errorLevel: ErrorLevel
  logoDataUrl?: string
  enabled: boolean
  scanCount: number
  createdAt: string
  updatedAt: string
}

export interface ScanRecord {
  id: string
  qrcodeId: string
  shortCode: string
  timestamp: string
  ip: string
  userAgent: string
  referer?: string
}

export interface BatchTask {
  id: string
  name: string
  baseUrl: string
  paramName: string
  totalCount: number
  successCount: number
  status: BatchStatus
  qrcodeIds: string[]
  createdAt: string
}

export interface CreateQrCodeRequest {
  name: string
  type: QrCodeType
  targetUrl: string
  shortCode?: string
  size?: number
  foreground?: string
  background?: string
  errorLevel?: ErrorLevel
  logoDataUrl?: string
}

export interface UpdateQrCodeRequest {
  name?: string
  targetUrl?: string
  size?: number
  foreground?: string
  background?: string
  errorLevel?: ErrorLevel
  logoDataUrl?: string
}

export interface BatchGenerateRequest {
  name: string
  baseUrl: string
  paramName: string
  paramValues: string[]
  template?: Partial<CreateQrCodeRequest>
}

export interface TrendPoint {
  date: string
  count: number
}

export interface OverviewStats {
  totalQrCodes: number
  activeQrCodes: number
  totalScans: number
  todayScans: number
  thisWeekScans: number
  topQrCodes: { id: string; name: string; scanCount: number }[]
  trendByDay: TrendPoint[]
}

export interface QrCodeStats {
  qrcode: QrCode
  totalScans: number
  todayScans: number
  thisWeekScans: number
  avgDaily: number
  trendByDay: TrendPoint[]
  trendByHour: TrendPoint[]
  recentRecords: ScanRecord[]
}

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type BackupType = 'full' | 'incremental'
export type BackupStatus = 'pending' | 'running' | 'completed' | 'failed' | 'corrupted'
export type RestoreStatus = 'pending' | 'running' | 'completed' | 'failed' | 'dry_run'
export type StorageType = 'local' | 's3'

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

export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  message?: string
}
