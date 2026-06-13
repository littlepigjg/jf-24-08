import type {
  QrCode,
  ScanRecord,
  BatchTask,
  CreateQrCodeRequest,
  UpdateQrCodeRequest,
  BatchGenerateRequest,
  OverviewStats,
  QrCodeStats,
  PagedResult,
  ApiResponse,
  BackupRecord,
  BackupStats,
  BackupScheduleConfig,
  RetentionPolicy,
  VerifyResult,
  RestoreResult,
} from "@shared/types";

const API_BASE = "/api";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const res = await fetch(API_BASE + path, { ...options, headers });
  const json = (await res.json()) as ApiResponse<T>;
  if (!json.success) {
    throw new Error(json.error || json.message || "请求失败");
  }
  return json.data as T;
}

export const api = {
  getOverviewStats(): Promise<OverviewStats> {
    return request<OverviewStats>("/stats/overview");
  },

  listQrCodes(params?: {
    page?: number;
    pageSize?: number;
    keyword?: string;
    type?: string;
    enabled?: boolean;
    sortBy?: string;
    sortOrder?: "asc" | "desc";
  }): Promise<PagedResult<QrCode>> {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    if (params?.keyword) q.set("keyword", params.keyword);
    if (params?.type) q.set("type", params.type);
    if (params?.enabled !== undefined) q.set("enabled", String(params.enabled));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    return request<PagedResult<QrCode>>(`/qrcodes${q.toString() ? `?${q.toString()}` : ""}`);
  },

  getQrCode(id: string): Promise<QrCode> {
    return request<QrCode>(`/qrcodes/${id}`);
  },

  createQrCode(data: CreateQrCodeRequest): Promise<QrCode> {
    return request<QrCode>("/qrcodes", { method: "POST", body: JSON.stringify(data) });
  },

  updateQrCode(id: string, data: UpdateQrCodeRequest): Promise<QrCode> {
    return request<QrCode>(`/qrcodes/${id}`, { method: "PATCH", body: JSON.stringify(data) });
  },

  deleteQrCode(id: string): Promise<void> {
    return request<void>(`/qrcodes/${id}`, { method: "DELETE" });
  },

  toggleQrCodeEnabled(id: string): Promise<QrCode> {
    return request<QrCode>(`/qrcodes/${id}/toggle`, { method: "POST" });
  },

  downloadQrCode(id: string, format: "png" | "svg" = "png", size?: number): Promise<Blob> {
    const q = new URLSearchParams();
    q.set("format", format);
    if (size) q.set("size", String(size));
    return fetch(`${API_BASE}/qrcodes/${id}/download?${q.toString()}`).then((r) => {
      if (!r.ok) throw new Error("下载失败");
      return r.blob();
    });
  },

  getQrCodeStats(id: string): Promise<QrCodeStats> {
    return request<QrCodeStats>(`/qrcodes/${id}/stats`);
  },

  listScanRecords(qrcodeId: string, params?: { page?: number; pageSize?: number }): Promise<PagedResult<ScanRecord>> {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return request<PagedResult<ScanRecord>>(
      `/qrcodes/${qrcodeId}/scans${q.toString() ? `?${q.toString()}` : ""}`
    );
  },

  createBatchTask(data: BatchGenerateRequest): Promise<BatchTask> {
    return request<BatchTask>("/batch", { method: "POST", body: JSON.stringify(data) });
  },

  getBatchTask(id: string): Promise<BatchTask> {
    return request<BatchTask>(`/batch/${id}`);
  },

  listBatchTasks(params?: { page?: number; pageSize?: number }): Promise<PagedResult<BatchTask>> {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return request<PagedResult<BatchTask>>(`/batch${q.toString() ? `?${q.toString()}` : ""}`);
  },

  downloadBatchZip(taskId: string): Promise<Blob> {
    return fetch(`${API_BASE}/batch/${taskId}/download`).then((r) => {
      if (!r.ok) throw new Error("下载失败");
      return r.blob();
    });
  },

  exportQrCodes(params: { ids: string[]; format: "zip" | "csv" | "scans_csv" | "full" }): Promise<Blob> {
    if (!Array.isArray(params.ids)) {
      throw new Error("ids 必须是数组");
    }
    if (params.ids.length === 0) {
      throw new Error("请至少选择一个二维码");
    }
    return fetch(`${API_BASE}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    }).then((r) => {
      if (!r.ok) throw new Error("导出失败");
      return r.blob();
    });
  },

  listExportTasks(params?: { page?: number; pageSize?: number }): Promise<PagedResult<BatchTask>> {
    const q = new URLSearchParams();
    if (params?.page) q.set("page", String(params.page));
    if (params?.pageSize) q.set("pageSize", String(params.pageSize));
    return request<PagedResult<BatchTask>>(`/export/tasks${q.toString() ? `?${q.toString()}` : ""}`);
  },

  backup: {
    getStats(): Promise<BackupStats> {
      return request<BackupStats>("/backup/stats");
    },
    listBackups(): Promise<BackupRecord[]> {
      return request<BackupRecord[]>("/backup/backups");
    },
    getBackup(id: string): Promise<BackupRecord> {
      return request<BackupRecord>(`/backup/backups/${id}`);
    },
    createFullBackup(metadata?: Record<string, unknown>): Promise<BackupRecord> {
      return request<BackupRecord>("/backup/backups/full", {
        method: "POST",
        body: JSON.stringify({ metadata }),
      });
    },
    createIncrementalBackup(metadata?: Record<string, unknown>): Promise<BackupRecord> {
      return request<BackupRecord>("/backup/backups/incremental", {
        method: "POST",
        body: JSON.stringify({ metadata }),
      });
    },
    verifyBackup(id: string): Promise<VerifyResult> {
      return request<VerifyResult>(`/backup/backups/${id}/verify`, { method: "POST" });
    },
    verifyAll(): Promise<VerifyResult[]> {
      return request<VerifyResult[]>("/backup/verify/all", { method: "POST" });
    },
    verifyLatest(): Promise<VerifyResult> {
      return request<VerifyResult>("/backup/verify/latest", { method: "POST" });
    },
    restore(id: string, options?: { targetPath?: string; dryRun?: boolean }): Promise<RestoreResult> {
      return request<RestoreResult>(`/backup/restore/${id}`, {
        method: "POST",
        body: JSON.stringify(options || {}),
      });
    },
    dryRunRestore(id: string): Promise<RestoreResult> {
      return request<RestoreResult>(`/backup/restore/${id}/dry-run`, { method: "POST" });
    },
    restoreDrill(backupId?: string): Promise<RestoreResult> {
      return request<RestoreResult>("/backup/restore/drill", {
        method: "POST",
        body: JSON.stringify({ backupId }),
      });
    },
    restoreLatest(): Promise<RestoreResult> {
      return request<RestoreResult>("/backup/restore/latest", { method: "POST" });
    },
    findPoint(time: string): Promise<BackupRecord> {
      return request<BackupRecord>("/backup/find-point", {
        method: "POST",
        body: JSON.stringify({ time }),
      });
    },
    getSchedule(): Promise<BackupScheduleConfig & { running: boolean; nextFullBackupTime: string; nextIncrementalBackupTime: string }> {
      return request("/backup/schedule");
    },
    updateSchedule(config: Partial<BackupScheduleConfig>): Promise<BackupScheduleConfig & { running: boolean }> {
      return request("/backup/schedule", {
        method: "PUT",
        body: JSON.stringify(config),
      });
    },
    startScheduler(): Promise<void> {
      return request("/backup/schedule/start", { method: "POST" });
    },
    stopScheduler(): Promise<void> {
      return request("/backup/schedule/stop", { method: "POST" });
    },
    getRetentionPolicy(): Promise<RetentionPolicy> {
      return request("/backup/retention");
    },
    updateRetentionPolicy(policy: Partial<RetentionPolicy>): Promise<RetentionPolicy> {
      return request("/backup/retention", {
        method: "PUT",
        body: JSON.stringify(policy),
      });
    },
    cleanup(): Promise<{ deleted: string[] }> {
      return request("/backup/cleanup", { method: "POST" });
    },
  },
};
