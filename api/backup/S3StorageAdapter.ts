import { createHash, createHmac } from 'node:crypto'
import type { StorageAdapter } from './StorageAdapter.js'
import type { StorageConfig } from './types.js'

interface S3Config {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  region: string
  prefix?: string
}

function sha256(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key as string | Buffer).update(data).digest()
}

function isoDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function shortDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function getSignatureKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = hmacSha256('AWS4' + secret, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'aws4_request')
  return kSigning
}

export class S3StorageAdapter implements StorageAdapter {
  readonly type = 's3'
  private config: S3Config

  constructor(config: NonNullable<StorageConfig['s3']>) {
    this.config = {
      endpoint: config.endpoint,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      prefix: config.prefix || '',
    }
  }

  private resolveKey(key: string): string {
    const normalizedKey = key.replace(/^\/+/, '')
    return this.config.prefix ? `${this.config.prefix}/${normalizedKey}` : normalizedKey
  }

  private getEndpointUrl(path: string): string {
    const endpoint = this.config.endpoint.replace(/\/$/, '')
    return `${endpoint}/${this.config.bucket}/${path}`
  }

  private async signRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    payload: Buffer | string = '',
  ): Promise<Record<string, string>> {
    const date = new Date()
    const amzDate = isoDate(date)
    const dateStamp = shortDate(date)
    const service = 's3'

    const signedHeaders = Object.keys(headers)
      .map((h) => h.toLowerCase())
      .sort()
      .join(';')

    headers['x-amz-date'] = amzDate
    headers['host'] = new URL(this.config.endpoint).host

    const payloadHash = sha256(typeof payload === 'string' ? payload : payload)
    headers['x-amz-content-sha256'] = payloadHash

    const canonicalQueryString = ''
    const canonicalHeaders = Object.entries(headers)
      .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(([k, v]) => `${k.toLowerCase()}:${v.trim()}`)
      .join('\n') + '\n'

    const canonicalRequest = [
      method,
      '/' + encodeURI(path).replace(/%2F/g, '/'),
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n')

    const algorithm = 'AWS4-HMAC-SHA256'
    const credentialScope = `${dateStamp}/${this.config.region}/${service}/aws4_request`
    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      sha256(canonicalRequest),
    ].join('\n')

    const signingKey = getSignatureKey(this.config.secretAccessKey, dateStamp, this.config.region, service)
    const signature = hmacSha256(signingKey, stringToSign).toString('hex')

    headers['Authorization'] = `${algorithm} Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`

    return headers
  }

  private async request(
    method: string,
    key: string,
    options: { body?: Buffer | string; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; headers: Headers; body: Buffer }> {
    const path = this.resolveKey(key)
    const url = this.getEndpointUrl(path)

    const headers: Record<string, string> = {
      ...(options.headers || {}),
    }

    const signedHeaders = await this.signRequest(method, path, headers, options.body || '')

    const response = await fetch(url, {
      method,
      headers: signedHeaders,
      body: options.body,
    })

    const arrayBuffer = await response.arrayBuffer()
    return {
      status: response.status,
      headers: response.headers,
      body: Buffer.from(arrayBuffer),
    }
  }

  async upload(key: string, data: Buffer | string): Promise<void> {
    const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data
    const result = await this.request('PUT', key, {
      body: buffer,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': buffer.length.toString(),
      },
    })

    if (result.status !== 200) {
      throw new Error(`S3 upload failed: ${result.status} ${result.body.toString('utf-8')}`)
    }
  }

  async download(key: string): Promise<Buffer> {
    const result = await this.request('GET', key)
    if (result.status === 404) {
      throw new Error(`S3 object not found: ${key}`)
    }
    if (result.status !== 200) {
      throw new Error(`S3 download failed: ${result.status} ${result.body.toString('utf-8')}`)
    }
    return result.body
  }

  async downloadAsString(key: string): Promise<string> {
    const buffer = await this.download(key)
    return buffer.toString('utf-8')
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.request('HEAD', key)
      return result.status === 200
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    await this.request('DELETE', key)
  }

  async list(prefix?: string): Promise<string[]> {
    const listPrefix = prefix ? this.resolveKey(prefix) : this.config.prefix
    const url = `${this.config.endpoint.replace(/\/$/, '')}/${this.config.bucket}?list-type=2${listPrefix ? `&prefix=${encodeURIComponent(listPrefix)}` : ''}`

    const path = this.config.bucket
    const headers = await this.signRequest('GET', path, {})
    headers['host'] = new URL(this.config.endpoint).host

    const response = await fetch(url, {
      method: 'GET',
      headers,
    })

    if (response.status !== 200) {
      return []
    }

    const xml = await response.text()
    const keys: string[] = []
    const matches = xml.matchAll(/<Key>([^<]+)<\/Key>/g)
    for (const match of matches) {
      const fullKey = match[1]
      const basePrefix = this.config.prefix ? this.config.prefix + '/' : ''
      if (fullKey.startsWith(basePrefix)) {
        keys.push(fullKey.slice(basePrefix.length))
      } else {
        keys.push(fullKey)
      }
    }
    return keys.sort()
  }

  async getSize(key: string): Promise<number> {
    const result = await this.request('HEAD', key)
    if (result.status !== 200) {
      throw new Error(`S3 head failed: ${result.status}`)
    }
    const contentLength = result.headers.get('content-length')
    return contentLength ? parseInt(contentLength, 10) : 0
  }
}
