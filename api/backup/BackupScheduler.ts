import type { BackupManager } from './BackupManager.js'
import type { BackupScheduleConfig } from './types.js'

export const DEFAULT_SCHEDULE_CONFIG: BackupScheduleConfig = {
  enabled: true,
  fullBackupCron: '0 2 * * *',
  incrementalBackupCron: '0 * * * *',
  retention: {
    keepDailyBackups: 30,
    keepHourlyBackups: 48,
    keepWeeklyBackups: 12,
    keepMonthlyBackups: 24,
    minBackupAgeDays: 1,
  },
  autoCleanup: true,
}

type CronField = {
  min: number
  max: number
}

const CRON_FIELDS: CronField[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
]

function parseCronField(field: string, cronField: CronField): Set<number> {
  const values = new Set<number>()

  if (field === '*') {
    for (let i = cronField.min; i <= cronField.max; i++) {
      values.add(i)
    }
    return values
  }

  const parts = field.split(',')
  for (const part of parts) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      let [start, end] = range === '*' ? [cronField.min, cronField.max] : range.split('-').map((n) => parseInt(n, 10))
      if (end === undefined) end = cronField.max
      for (let i = start; i <= end; i += step) {
        values.add(i)
      }
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n, 10))
      for (let i = start; i <= end; i++) {
        values.add(i)
      }
    } else {
      values.add(parseInt(part, 10))
    }
  }

  return values
}

function parseCron(expression: string): Set<number>[] {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error('Invalid cron expression. Expected 5 fields.')
  }
  return fields.map((field, index) => parseCronField(field, CRON_FIELDS[index]))
}

function matchesCron(date: Date, cronParts: Set<number>[]): boolean {
  return (
    cronParts[0].has(date.getMinutes()) &&
    cronParts[1].has(date.getHours()) &&
    cronParts[2].has(date.getDate()) &&
    cronParts[3].has(date.getMonth() + 1) &&
    cronParts[4].has(date.getDay())
  )
}

export class BackupScheduler {
  private backupManager: BackupManager
  private config: BackupScheduleConfig
  private fullCronParts: Set<number>[]
  private incrementalCronParts: Set<number>[]
  private timer: NodeJS.Timeout | null = null
  private lastFullBackupMinute = -1
  private lastIncrementalBackupMinute = -1
  private running = false

  constructor(backupManager: BackupManager, config?: Partial<BackupScheduleConfig>) {
    this.backupManager = backupManager
    this.config = { ...DEFAULT_SCHEDULE_CONFIG, ...(config || {}) }
    this.fullCronParts = parseCron(this.config.fullBackupCron)
    this.incrementalCronParts = parseCron(this.config.incrementalBackupCron)
  }

  updateConfig(config: Partial<BackupScheduleConfig>): void {
    this.config = { ...this.config, ...config }
    this.fullCronParts = parseCron(this.config.fullBackupCron)
    this.incrementalCronParts = parseCron(this.config.incrementalBackupCron)

    if (this.config.retention) {
      this.backupManager.updateRetentionPolicy(this.config.retention)
    }
  }

  getConfig(): BackupScheduleConfig {
    return { ...this.config }
  }

  start(): void {
    if (this.timer) return
    this.running = true

    const tick = async () => {
      if (!this.running || !this.config.enabled) return

      const now = new Date()
      const currentMinute = now.getHours() * 60 + now.getMinutes()

      if (matchesCron(now, this.fullCronParts) && currentMinute !== this.lastFullBackupMinute) {
        this.lastFullBackupMinute = currentMinute
        try {
          await this.backupManager.createFullBackup({ trigger: 'scheduled-full' })
        } catch (error) {
          console.error('Scheduled full backup failed:', error)
        }
        if (this.config.autoCleanup) {
          try {
            await this.backupManager.cleanupOldBackups()
          } catch (error) {
            console.error('Backup cleanup failed:', error)
          }
        }
      } else if (matchesCron(now, this.incrementalCronParts) && currentMinute !== this.lastIncrementalBackupMinute) {
        this.lastIncrementalBackupMinute = currentMinute
        try {
          await this.backupManager.createIncrementalBackup({ trigger: 'scheduled-incremental' })
        } catch (error) {
          console.error('Scheduled incremental backup failed:', error)
        }
      }
    }

    this.timer = setInterval(tick, 30000)
    tick().catch(console.error)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  isRunning(): boolean {
    return this.running && this.config.enabled
  }

  getNextFullBackupTime(from: Date = new Date()): Date {
    const next = new Date(from)
    next.setSeconds(0, 0)

    for (let i = 0; i < 60 * 24 * 366; i++) {
      next.setMinutes(next.getMinutes() + 1)
      if (matchesCron(next, this.fullCronParts)) {
        return next
      }
    }
    return next
  }

  getNextIncrementalBackupTime(from: Date = new Date()): Date {
    const next = new Date(from)
    next.setSeconds(0, 0)

    for (let i = 0; i < 60 * 24 * 366; i++) {
      next.setMinutes(next.getMinutes() + 1)
      if (matchesCron(next, this.incrementalCronParts)) {
        return next
      }
    }
    return next
  }
}
