import { Router, type Request, type Response } from 'express'
import {
  backupManager,
  restoreManager,
  verifyManager,
  backupScheduler,
  initBackupService,
} from '../backup/index.js'

const router = Router()

router.use(async (req: Request, res: Response, next) => {
  try {
    await initBackupService()
    next()
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.get('/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const stats = backupManager.getStats()
    res.json({ success: true, data: stats })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.get('/backups', async (req: Request, res: Response): Promise<void> => {
  try {
    const backups = backupManager.listBackups()
    res.json({ success: true, data: backups })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.get('/backups/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const backup = backupManager.getBackupById(req.params.id)
    if (!backup) {
      res.status(404).json({ success: false, error: 'Backup not found' })
      return
    }
    res.json({ success: true, data: backup })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/backups/full', async (req: Request, res: Response): Promise<void> => {
  try {
    if (backupManager.isBackupRunning()) {
      res.status(409).json({ success: false, error: 'A backup is already in progress' })
      return
    }
    const metadata = (req.body?.metadata as Record<string, unknown>) || {}
    const record = await backupManager.createFullBackup(metadata)
    res.json({ success: true, data: record })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/backups/incremental', async (req: Request, res: Response): Promise<void> => {
  try {
    if (backupManager.isBackupRunning()) {
      res.status(409).json({ success: false, error: 'A backup is already in progress' })
      return
    }
    const metadata = (req.body?.metadata as Record<string, unknown>) || {}
    const record = await backupManager.createIncrementalBackup(metadata)
    res.json({ success: true, data: record })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/backups/:id/verify', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await verifyManager.verifyBackup(req.params.id)
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/verify/all', async (req: Request, res: Response): Promise<void> => {
  try {
    const results = await verifyManager.verifyAllBackups()
    res.json({ success: true, data: results })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/verify/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await verifyManager.verifyLatest()
    if (!result) {
      res.status(404).json({ success: false, error: 'No backups available' })
      return
    }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/restore/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const targetPath = req.body?.targetPath as string | undefined
    const dryRun = (req.body?.dryRun as boolean) || false
    const result = await restoreManager.restoreToPointInTime(req.params.id, { targetPath, dryRun })
    if (result.status === 'failed') {
      res.status(500).json({ success: false, error: result.errorMessage, data: result })
      return
    }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/restore/:id/dry-run', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await restoreManager.dryRunRestore(req.params.id)
    if (result.status === 'failed') {
      res.status(500).json({ success: false, error: result.errorMessage, data: result })
      return
    }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/restore/drill', async (req: Request, res: Response): Promise<void> => {
  try {
    const backupId = req.body?.backupId as string | undefined
    const result = await restoreManager.restoreDrill(backupId)
    if (result.status === 'failed') {
      res.status(500).json({ success: false, error: result.errorMessage, data: result })
      return
    }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/restore/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await restoreManager.restoreLatest()
    if (result.status === 'failed') {
      res.status(500).json({ success: false, error: result.errorMessage, data: result })
      return
    }
    res.json({ success: true, data: result })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/find-point', async (req: Request, res: Response): Promise<void> => {
  try {
    const time = req.body?.time as string | undefined
    if (!time) {
      res.status(400).json({ success: false, error: 'time is required' })
      return
    }
    const backup = restoreManager.findNearestBackup(time)
    if (!backup) {
      res.status(404).json({ success: false, error: 'No backup found near the specified time' })
      return
    }
    res.json({ success: true, data: backup })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.get('/schedule', async (req: Request, res: Response): Promise<void> => {
  try {
    const config = backupScheduler.getConfig()
    res.json({
      success: true,
      data: {
        ...config,
        running: backupScheduler.isRunning(),
        nextFullBackupTime: backupScheduler.getNextFullBackupTime().toISOString(),
        nextIncrementalBackupTime: backupScheduler.getNextIncrementalBackupTime().toISOString(),
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.put('/schedule', async (req: Request, res: Response): Promise<void> => {
  try {
    backupScheduler.updateConfig(req.body)
    const config = backupScheduler.getConfig()
    res.json({
      success: true,
      data: {
        ...config,
        running: backupScheduler.isRunning(),
      },
    })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/schedule/start', async (req: Request, res: Response): Promise<void> => {
  try {
    backupScheduler.start()
    res.json({ success: true, message: 'Scheduler started' })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/schedule/stop', async (req: Request, res: Response): Promise<void> => {
  try {
    backupScheduler.stop()
    res.json({ success: true, message: 'Scheduler stopped' })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.get('/retention', async (req: Request, res: Response): Promise<void> => {
  try {
    const policy = backupManager.getRetentionPolicy()
    res.json({ success: true, data: policy })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.put('/retention', async (req: Request, res: Response): Promise<void> => {
  try {
    backupManager.updateRetentionPolicy(req.body)
    const policy = backupManager.getRetentionPolicy()
    res.json({ success: true, data: policy })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

router.post('/cleanup', async (req: Request, res: Response): Promise<void> => {
  try {
    const deleted = await backupManager.cleanupOldBackups()
    res.json({ success: true, data: { deleted } })
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message })
  }
})

export default router
