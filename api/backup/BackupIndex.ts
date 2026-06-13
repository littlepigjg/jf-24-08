import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BackupRecord, BackupStatus } from './types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const INDEX_DIR = path.resolve(__dirname, '..', '..', 'backup-index')
const INDEX_FILE = path.join(INDEX_DIR, 'backup-index.json')

interface BackupIndexData {
  records: BackupRecord[]
  lastChainHash: string
}

export class BackupIndex {
  private data: BackupIndexData

  constructor() {
    this.data = {
      records: [],
      lastChainHash: '',
    }
  }

  async init(): Promise<void> {
    await fs.mkdir(INDEX_DIR, { recursive: true })
    try {
      const content = await fs.readFile(INDEX_FILE, 'utf-8')
      this.data = JSON.parse(content) as BackupIndexData
    } catch {
      this.data = { records: [], lastChainHash: '' }
      await this.save()
    }
  }

  private async save(): Promise<void> {
    await fs.mkdir(INDEX_DIR, { recursive: true })
    await fs.writeFile(INDEX_FILE, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  getLastChainHash(): string {
    return this.data.lastChainHash
  }

  setLastChainHash(hash: string): void {
    this.data.lastChainHash = hash
  }

  async addRecord(record: BackupRecord): Promise<void> {
    this.data.records.unshift(record)
    await this.save()
  }

  async updateRecord(id: string, updates: Partial<BackupRecord>): Promise<BackupRecord | undefined> {
    const index = this.data.records.findIndex((r) => r.id === id)
    if (index === -1) return undefined
    this.data.records[index] = { ...this.data.records[index], ...updates }
    await this.save()
    return this.data.records[index]
  }

  getAll(): BackupRecord[] {
    return [...this.data.records]
  }

  getById(id: string): BackupRecord | undefined {
    return this.data.records.find((r) => r.id === id)
  }

  getByStatus(status: BackupStatus): BackupRecord[] {
    return this.data.records.filter((r) => r.status === status)
  }

  getByType(type: 'full' | 'incremental'): BackupRecord[] {
    return this.data.records.filter((r) => r.type === type)
  }

  getLatestFullBackup(): BackupRecord | undefined {
    return this.data.records.find((r) => r.type === 'full' && r.status === 'completed')
  }

  getLatestBackup(): BackupRecord | undefined {
    return this.data.records.find((r) => r.status === 'completed')
  }

  getBackupsAfter(timestamp: string): BackupRecord[] {
    return this.data.records.filter((r) => r.timestamp >= timestamp && r.status === 'completed')
  }

  getBackupsBetween(start: string, end: string): BackupRecord[] {
    return this.data.records.filter(
      (r) => r.timestamp >= start && r.timestamp <= end && r.status === 'completed',
    )
  }

  getBackupChain(targetId: string): BackupRecord[] {
    const chain: BackupRecord[] = []
    let current = this.getById(targetId)
    while (current) {
      chain.unshift(current)
      if (!current.parentId) break
      current = this.getById(current.parentId)
    }
    return chain
  }

  async deleteRecord(id: string): Promise<boolean> {
    const index = this.data.records.findIndex((r) => r.id === id)
    if (index === -1) return false
    this.data.records.splice(index, 1)
    await this.save()
    return true
  }

  clear(): void {
    this.data = { records: [], lastChainHash: '' }
  }
}

export const backupIndex = new BackupIndex()
