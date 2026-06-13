import { createHash, createDiffieHellman } from 'node:crypto'
import fs from 'node:fs/promises'

export function computeSha256(data: Buffer | string): string {
  const hash = createHash('sha256')
  hash.update(typeof data === 'string' ? Buffer.from(data, 'utf-8') : data)
  return hash.digest('hex')
}

export async function computeFileSha256(filePath: string): Promise<string> {
  const data = await fs.readFile(filePath)
  return computeSha256(data)
}

export function generateBackupId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 10)
  return `bkp_${timestamp}_${random}`
}

export function computeChainHash(previousHash: string, currentContent: string): string {
  const combined = previousHash + currentContent
  return computeSha256(combined)
}

export function formatTimestamp(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const h = pad(date.getHours())
  const min = pad(date.getMinutes())
  const s = pad(date.getSeconds())
  return `${y}${m}${d}_${h}${min}${s}`
}

export function formatDatePath(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  return `${y}/${m}/${d}`
}
