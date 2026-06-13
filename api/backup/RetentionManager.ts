import type { BackupRecord, RetentionPolicy } from './types.js'

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = {
  keepDailyBackups: 30,
  keepHourlyBackups: 48,
  keepWeeklyBackups: 12,
  keepMonthlyBackups: 24,
  minBackupAgeDays: 1,
}

export class RetentionManager {
  private policy: RetentionPolicy

  constructor(policy?: Partial<RetentionPolicy>) {
    this.policy = { ...DEFAULT_RETENTION_POLICY, ...(policy || {}) }
  }

  updatePolicy(policy: Partial<RetentionPolicy>): void {
    this.policy = { ...this.policy, ...policy }
  }

  getPolicy(): RetentionPolicy {
    return { ...this.policy }
  }

  private parseDate(timestamp: string): Date {
    return new Date(timestamp)
  }

  private isSameDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    )
  }

  private isSameHour(a: Date, b: Date): boolean {
    return this.isSameDay(a, b) && a.getHours() === b.getHours()
  }

  private isSameWeek(a: Date, b: Date): boolean {
    const weekStart = (d: Date) => {
      const date = new Date(d)
      const day = date.getDay()
      date.setDate(date.getDate() - day)
      date.setHours(0, 0, 0, 0)
      return date.getTime()
    }
    return weekStart(a) === weekStart(b)
  }

  private isSameMonth(a: Date, b: Date): boolean {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
  }

  getBackupsToDelete(records: BackupRecord[], now: Date = new Date()): string[] {
    const completed = records.filter((r) => r.status === 'completed')
    const toDelete = new Set<string>()
    const minAgeMs = this.policy.minBackupAgeDays * 24 * 60 * 60 * 1000

    const tooOldForRetention: BackupRecord[] = []
    const eligibleForRetention: BackupRecord[] = []

    for (const record of completed) {
      const recordDate = this.parseDate(record.timestamp)
      const ageMs = now.getTime() - recordDate.getTime()
      if (ageMs < minAgeMs) {
        continue
      }
      eligibleForRetention.push(record)
    }

    const sorted = [...eligibleForRetention].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )

    const keptHourly = new Set<string>()
    const keptDaily = new Set<string>()
    const keptWeekly = new Set<string>()
    const keptMonthly = new Set<string>()

    let hourlyCount = 0
    for (const record of sorted) {
      if (hourlyCount >= this.policy.keepHourlyBackups) break
      const recordDate = this.parseDate(record.timestamp)
      const alreadyKept = Array.from(keptHourly).some((id) => {
        const existing = sorted.find((r) => r.id === id)
        return existing && this.isSameHour(this.parseDate(existing.timestamp), recordDate)
      })
      if (!alreadyKept) {
        keptHourly.add(record.id)
        hourlyCount++
      }
    }

    let dailyCount = 0
    for (const record of sorted) {
      if (dailyCount >= this.policy.keepDailyBackups) break
      const recordDate = this.parseDate(record.timestamp)
      const alreadyKept = Array.from(keptDaily).some((id) => {
        const existing = sorted.find((r) => r.id === id)
        return existing && this.isSameDay(this.parseDate(existing.timestamp), recordDate)
      })
      if (!alreadyKept) {
        keptDaily.add(record.id)
        dailyCount++
      }
    }

    let weeklyCount = 0
    for (const record of sorted) {
      if (weeklyCount >= this.policy.keepWeeklyBackups) break
      const recordDate = this.parseDate(record.timestamp)
      const alreadyKept = Array.from(keptWeekly).some((id) => {
        const existing = sorted.find((r) => r.id === id)
        return existing && this.isSameWeek(this.parseDate(existing.timestamp), recordDate)
      })
      if (!alreadyKept) {
        keptWeekly.add(record.id)
        weeklyCount++
      }
    }

    let monthlyCount = 0
    for (const record of sorted) {
      if (monthlyCount >= this.policy.keepMonthlyBackups) break
      const recordDate = this.parseDate(record.timestamp)
      const alreadyKept = Array.from(keptMonthly).some((id) => {
        const existing = sorted.find((r) => r.id === id)
        return existing && this.isSameMonth(this.parseDate(existing.timestamp), recordDate)
      })
      if (!alreadyKept) {
        keptMonthly.add(record.id)
        monthlyCount++
      }
    }

    const allKept = new Set([
      ...keptHourly,
      ...keptDaily,
      ...keptWeekly,
      ...keptMonthly,
    ])

    const preserved: Set<string> = new Set()
    for (const id of allKept) {
      const record = records.find((r) => r.id === id)
      if (record && record.type === 'incremental') {
        let currentId: string | undefined = record.parentId
        while (currentId) {
          preserved.add(currentId)
          const parent = records.find((r) => r.id === currentId)
          currentId = parent?.parentId
        }
      }
    }

    const finalKept = new Set([...allKept, ...preserved])

    for (const record of sorted) {
      if (!finalKept.has(record.id)) {
        toDelete.add(record.id)
      }
    }

    return Array.from(toDelete)
  }
}
