import { useEffect, useState, useCallback } from "react";
import {
  ShieldCheck,
  Database,
  Clock,
  HardDrive,
  Play,
  Pause,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  RotateCcw,
  FileCheck,
  Trash2,
  ChevronDown,
  ChevronUp,
  CalendarClock,
  Layers,
  Save,
  Settings2,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";
import type {
  BackupRecord,
  BackupStats,
  BackupScheduleConfig,
  RetentionPolicy,
  VerifyResult,
  RestoreResult,
} from "@shared/types";

type TabKey = "overview" | "backups" | "schedule" | "restore";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatTime(iso?: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const statusConfig: Record<string, { label: string; cls: string; icon: typeof CheckCircle2 }> = {
  completed: { label: "完成", cls: "tag-green", icon: CheckCircle2 },
  running: { label: "运行中", cls: "tag-blue", icon: Loader2 },
  pending: { label: "等待中", cls: "tag-orange", icon: Clock },
  failed: { label: "失败", cls: "tag-red", icon: XCircle },
  corrupted: { label: "已损坏", cls: "tag-red", icon: AlertTriangle },
  dry_run: { label: "演练完成", cls: "tag-blue", icon: FileCheck },
};

function StatusTag({ status }: { status: string }) {
  const cfg = statusConfig[status] || statusConfig.failed;
  const Icon = cfg.icon;
  return (
    <span className={cfg.cls}>
      <Icon className={`w-3 h-3 ${status === "running" ? "animate-spin" : ""}`} />
      {cfg.label}
    </span>
  );
}

export default function BackupCenter() {
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [stats, setStats] = useState<BackupStats | null>(null);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [schedule, setSchedule] = useState<BackupScheduleConfig & { running?: boolean; nextFullBackupTime?: string; nextIncrementalBackupTime?: string } | null>(null);
  const [retention, setRetention] = useState<RetentionPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [verifyResults, setVerifyResults] = useState<VerifyResult[]>([]);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);
  const [expandedBackup, setExpandedBackup] = useState<string | null>(null);
  const [restoreTargetId, setRestoreTargetId] = useState("");
  const [findPointTime, setFindPointTime] = useState("");
  const [foundBackup, setFoundBackup] = useState<BackupRecord | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const showToast = useCallback((msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, b, sch, ret] = await Promise.all([
        api.backup.getStats().catch(() => null),
        api.backup.listBackups().catch(() => []),
        api.backup.getSchedule().catch(() => null),
        api.backup.getRetentionPolicy().catch(() => null),
      ]);
      if (s) setStats(s);
      setBackups(b);
      if (sch) setSchedule(sch);
      if (ret) setRetention(ret);
    } catch {
      showToast("刷新数据失败", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleFullBackup = async () => {
    setActionLoading("full");
    try {
      await api.backup.createFullBackup({ trigger: "manual" });
      showToast("全量备份创建成功");
      await refreshAll();
    } catch (e: any) {
      showToast(e.message || "全量备份失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleIncrementalBackup = async () => {
    setActionLoading("incremental");
    try {
      await api.backup.createIncrementalBackup({ trigger: "manual" });
      showToast("增量备份创建成功");
      await refreshAll();
    } catch (e: any) {
      showToast(e.message || "增量备份失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerify = async (id: string) => {
    setActionLoading(`verify-${id}`);
    try {
      const result = await api.backup.verifyBackup(id);
      setVerifyResults((prev) => {
        const filtered = prev.filter((r) => r.backupId !== id);
        return [result, ...filtered];
      });
      if (result.valid) {
        showToast("备份校验通过");
      } else {
        showToast("备份校验失败，数据可能损坏", "error");
      }
      await refreshAll();
    } catch (e: any) {
      showToast(e.message || "校验失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleVerifyAll = async () => {
    setActionLoading("verify-all");
    try {
      const results = await api.backup.verifyAll();
      setVerifyResults(results);
      const allValid = results.every((r) => r.valid);
      if (allValid) {
        showToast("所有备份校验通过");
      } else {
        const failed = results.filter((r) => !r.valid).length;
        showToast(`${failed} 个备份校验失败`, "error");
      }
      await refreshAll();
    } catch (e: any) {
      showToast(e.message || "校验失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestoreDrill = async (backupId?: string) => {
    setActionLoading("drill");
    setRestoreResult(null);
    try {
      const result = await api.backup.restoreDrill(backupId);
      setRestoreResult(result);
      if (result.status === "dry_run" || result.status === "completed") {
        showToast("恢复演练成功完成");
      } else {
        showToast(result.errorMessage || "恢复演练失败", "error");
      }
    } catch (e: any) {
      showToast(e.message || "恢复演练失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleDryRunRestore = async (id: string) => {
    setActionLoading(`dryrun-${id}`);
    setRestoreResult(null);
    try {
      const result = await api.backup.dryRunRestore(id);
      setRestoreResult(result);
      if (result.status === "dry_run") {
        showToast("预恢复校验通过");
      } else {
        showToast(result.errorMessage || "预恢复失败", "error");
      }
    } catch (e: any) {
      showToast(e.message || "预恢复失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleRestore = async (id: string) => {
    if (!confirm(`确认恢复到备份 ${id.slice(0, 12)}... ？此操作将覆盖当前数据文件。`)) return;
    setActionLoading(`restore-${id}`);
    setRestoreResult(null);
    try {
      const result = await api.backup.restore(id);
      setRestoreResult(result);
      if (result.status === "completed") {
        showToast("数据恢复成功");
      } else {
        showToast(result.errorMessage || "恢复失败", "error");
      }
    } catch (e: any) {
      showToast(e.message || "恢复失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleFindPoint = async () => {
    if (!findPointTime) return;
    setActionLoading("find");
    try {
      const backup = await api.backup.findPoint(findPointTime);
      setFoundBackup(backup);
      showToast("已找到最近备份点");
    } catch (e: any) {
      showToast(e.message || "未找到备份点", "error");
      setFoundBackup(null);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleScheduler = async () => {
    if (!schedule) return;
    setActionLoading("toggle-scheduler");
    try {
      if (schedule.running) {
        await api.backup.stopScheduler();
        showToast("调度器已停止");
      } else {
        await api.backup.startScheduler();
        showToast("调度器已启动");
      }
      await refreshAll();
    } catch (e: any) {
      showToast(e.message || "操作失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCleanup = async () => {
    setActionLoading("cleanup");
    try {
      const result = await api.backup.cleanup();
      showToast(`清理完成，删除 ${result.deleted.length} 个过期备份`);
      await refreshAll();
    } catch (e: any) {
      showToast(e.message || "清理失败", "error");
    } finally {
      setActionLoading(null);
    }
  };

  const handleUpdateRetention = async (policy: Partial<RetentionPolicy>) => {
    try {
      const updated = await api.backup.updateRetentionPolicy(policy);
      setRetention(updated);
      showToast("保留策略已更新");
    } catch (e: any) {
      showToast(e.message || "更新失败", "error");
    }
  };

  const tabs: { key: TabKey; label: string; icon: typeof Database }[] = [
    { key: "overview", label: "总览", icon: Activity },
    { key: "backups", label: "备份列表", icon: Database },
    { key: "schedule", label: "调度策略", icon: CalendarClock },
    { key: "restore", label: "恢复演练", icon: RotateCcw },
  ];

  return (
    <div className="space-y-6">
      {toast && (
        <div
          className={`fixed top-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium flex items-center gap-2 animate-fade-up ${
            toast.type === "success"
              ? "bg-success-500/90 text-white"
              : "bg-danger-500/90 text-white"
          }`}
        >
          {toast.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-white flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-400" />
            容灾备份中心
          </h1>
          <p className="text-dark-400 mt-1 text-sm">
            数据快照备份 · 时间点恢复 · 增量备份 · 完整性校验
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleFullBackup} disabled={actionLoading !== null} className="btn-primary">
            {actionLoading === "full" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            全量备份
          </button>
          <button onClick={handleIncrementalBackup} disabled={actionLoading !== null} className="btn-secondary">
            {actionLoading === "incremental" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Layers className="w-4 h-4" />}
            增量备份
          </button>
          <button onClick={refreshAll} className="btn-ghost">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="flex gap-1 border-b border-dark-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
              activeTab === tab.key
                ? "text-brand-400 border-brand-400"
                : "text-dark-400 border-transparent hover:text-white hover:border-dark-500"
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <OverviewTab
          stats={stats}
          schedule={schedule}
          backups={backups}
          loading={loading}
          onVerifyAll={handleVerifyAll}
          onDrill={handleRestoreDrill}
          onCleanup={handleCleanup}
          actionLoading={actionLoading}
          verifyResults={verifyResults}
        />
      )}
      {activeTab === "backups" && (
        <BackupsTab
          backups={backups}
          expandedBackup={expandedBackup}
          setExpandedBackup={setExpandedBackup}
          onVerify={handleVerify}
          onDryRun={handleDryRunRestore}
          onRestore={handleRestore}
          actionLoading={actionLoading}
          verifyResults={verifyResults}
        />
      )}
      {activeTab === "schedule" && (
        <ScheduleTab
          schedule={schedule}
          retention={retention}
          onToggleScheduler={handleToggleScheduler}
          onUpdateRetention={handleUpdateRetention}
          actionLoading={actionLoading}
        />
      )}
      {activeTab === "restore" && (
        <RestoreTab
          backups={backups}
          restoreResult={restoreResult}
          restoreTargetId={restoreTargetId}
          setRestoreTargetId={setRestoreTargetId}
          findPointTime={findPointTime}
          setFindPointTime={setFindPointTime}
          foundBackup={foundBackup}
          onFindPoint={handleFindPoint}
          onDrill={handleRestoreDrill}
          onRestore={handleRestore}
          onDryRun={handleDryRunRestore}
          actionLoading={actionLoading}
        />
      )}
    </div>
  );
}

function OverviewTab({
  stats,
  schedule,
  backups,
  loading,
  onVerifyAll,
  onDrill,
  onCleanup,
  actionLoading,
  verifyResults,
}: {
  stats: BackupStats | null;
  schedule: BackupScheduleConfig & { running?: boolean; nextFullBackupTime?: string; nextIncrementalBackupTime?: string } | null;
  backups: BackupRecord[];
  loading: boolean;
  onVerifyAll: () => void;
  onDrill: () => void;
  onCleanup: () => void;
  actionLoading: string | null;
  verifyResults: VerifyResult[];
}) {
  if (loading && !stats) {
    return (
      <div className="flex items-center justify-center py-20 text-dark-500">
        <Loader2 className="w-6 h-6 animate-spin mr-2" /> 加载中...
      </div>
    );
  }

  const completedBackups = backups.filter((b) => b.status === "completed");
  const failedBackups = backups.filter((b) => b.status === "failed");
  const corruptedBackups = backups.filter((b) => b.status === "corrupted");
  const lastBackup = completedBackups[0];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-dark-400 text-sm mb-1">
              <Database className="w-4 h-4" /> 总备份数
            </div>
            <p className="text-2xl font-bold text-white">{stats?.totalBackups ?? 0}</p>
            <p className="text-xs text-dark-500 mt-1">
              全量 {stats?.fullBackups ?? 0} · 增量 {stats?.incrementalBackups ?? 0}
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-dark-400 text-sm mb-1">
              <HardDrive className="w-4 h-4" /> 存储用量
            </div>
            <p className="text-2xl font-bold text-white">{formatBytes(stats?.totalSize ?? 0)}</p>
            <p className="text-xs text-dark-500 mt-1">
              备份文件总大小
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-dark-400 text-sm mb-1">
              <Clock className="w-4 h-4" /> 最近备份
            </div>
            <p className="text-lg font-bold text-white">{lastBackup ? formatTime(lastBackup.timestamp) : "-"}</p>
            <p className="text-xs mt-1">
              {lastBackup ? (
                <StatusTag status={lastBackup.status} />
              ) : (
                <span className="text-dark-500">暂无备份</span>
              )}
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="relative z-10">
            <div className="flex items-center gap-2 text-dark-400 text-sm mb-1">
              <CalendarClock className="w-4 h-4" /> 调度状态
            </div>
            <p className="text-lg font-bold text-white">
              {schedule?.running ? "运行中" : "已停止"}
            </p>
            <p className="text-xs text-dark-500 mt-1">
              下次全量: {schedule?.nextFullBackupTime ? formatTime(schedule.nextFullBackupTime) : "-"}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-brand-400" />
              快捷操作
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={onVerifyAll}
              disabled={actionLoading !== null}
              className="btn-secondary text-sm justify-start"
            >
              {actionLoading === "verify-all" ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck className="w-4 h-4 text-success-500" />}
              校验全部备份
            </button>
            <button
              onClick={onDrill}
              disabled={actionLoading !== null}
              className="btn-secondary text-sm justify-start"
            >
              {actionLoading === "drill" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4 text-warning-500" />}
              一键恢复演练
            </button>
            <button
              onClick={onCleanup}
              disabled={actionLoading !== null}
              className="btn-secondary text-sm justify-start"
            >
              {actionLoading === "cleanup" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4 text-danger-500" />}
              清理过期备份
            </button>
            <div className="flex items-center justify-center text-dark-500 text-xs">
              {failedBackups.length > 0 && (
                <span className="tag-red"><AlertTriangle className="w-3 h-3" />{failedBackups.length} 个失败</span>
              )}
              {corruptedBackups.length > 0 && (
                <span className="tag-red ml-2"><XCircle className="w-3 h-3" />{corruptedBackups.length} 个损坏</span>
              )}
              {failedBackups.length === 0 && corruptedBackups.length === 0 && (
                <span className="tag-green"><CheckCircle2 className="w-3 h-3" />全部正常</span>
              )}
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-brand-400" />
              校验结果
            </h3>
            {verifyResults.length > 0 && (
              <span className="tag-gray text-xs">{verifyResults.length} 条</span>
            )}
          </div>
          {verifyResults.length === 0 ? (
            <div className="text-center py-8 text-dark-500">
              <FileCheck className="w-10 h-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">尚未执行校验</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {verifyResults.slice(0, 10).map((vr) => (
                <div
                  key={vr.backupId}
                  className="flex items-center justify-between px-3 py-2 rounded-lg bg-dark-900/40 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {vr.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-success-500" />
                    ) : (
                      <XCircle className="w-4 h-4 text-danger-500" />
                    )}
                    <span className="text-dark-200 font-mono text-xs">{vr.backupId.slice(0, 20)}...</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-dark-400 text-xs">
                      {vr.chainValid ? "链完整" : "链断裂"}
                    </span>
                    <span className={vr.valid ? "tag-green" : "tag-red"}>
                      {vr.valid ? "通过" : "失败"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackupsTab({
  backups,
  expandedBackup,
  setExpandedBackup,
  onVerify,
  onDryRun,
  onRestore,
  actionLoading,
  verifyResults,
}: {
  backups: BackupRecord[];
  expandedBackup: string | null;
  setExpandedBackup: (id: string | null) => void;
  onVerify: (id: string) => void;
  onDryRun: (id: string) => void;
  onRestore: (id: string) => void;
  actionLoading: string | null;
  verifyResults: VerifyResult[];
}) {
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-dark-900/60">
            <tr>
              <th className="table-head w-8"></th>
              <th className="table-head">备份ID</th>
              <th className="table-head">类型</th>
              <th className="table-head">状态</th>
              <th className="table-head">大小</th>
              <th className="table-head">文件数</th>
              <th className="table-head">时间</th>
              <th className="table-head">校验</th>
              <th className="table-head text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {backups.length === 0 ? (
              <tr>
                <td colSpan={9} className="table-cell text-center py-12 text-dark-500">
                  <Database className="w-12 h-12 mx-auto mb-2 opacity-30" />
                  <p>暂无备份记录</p>
                </td>
              </tr>
            ) : (
              backups.map((b) => {
                const expanded = expandedBackup === b.id;
                const vr = verifyResults.find((r) => r.backupId === b.id);
                return (
                  <>
                    <tr key={b.id} className="table-row">
                      <td className="table-cell">
                        <button onClick={() => setExpandedBackup(expanded ? null : b.id)}>
                          {expanded ? (
                            <ChevronUp className="w-4 h-4 text-dark-400" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-dark-400" />
                          )}
                        </button>
                      </td>
                      <td className="table-cell">
                        <span className="font-mono text-sm text-brand-400">{b.id.slice(0, 24)}</span>
                        {b.parentId && (
                          <p className="text-xs text-dark-500 mt-0.5">父: {b.parentId.slice(0, 16)}...</p>
                        )}
                      </td>
                      <td className="table-cell">
                        {b.type === "full" ? (
                          <span className="tag-blue">全量</span>
                        ) : (
                          <span className="tag-orange">增量</span>
                        )}
                      </td>
                      <td className="table-cell">
                        <StatusTag status={b.status} />
                      </td>
                      <td className="table-cell text-white font-semibold">{formatBytes(b.totalSize)}</td>
                      <td className="table-cell text-dark-300">{b.fileCount}</td>
                      <td className="table-cell text-dark-400 text-xs whitespace-nowrap">
                        {formatTime(b.timestamp)}
                      </td>
                      <td className="table-cell">
                        {b.verified ? (
                          <span className="tag-green"><CheckCircle2 className="w-3 h-3" />已校验</span>
                        ) : (
                          <span className="tag-gray">未校验</span>
                        )}
                      </td>
                      <td className="table-cell text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => onVerify(b.id)}
                            disabled={actionLoading !== null}
                            className="btn-ghost text-xs px-2 py-1"
                            title="校验完整性"
                          >
                            {actionLoading === `verify-${b.id}` ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <FileCheck className="w-3 h-3" />
                            )}
                          </button>
                          {b.status === "completed" && (
                            <>
                              <button
                                onClick={() => onDryRun(b.id)}
                                disabled={actionLoading !== null}
                                className="btn-ghost text-xs px-2 py-1"
                                title="预恢复"
                              >
                                {actionLoading === `dryrun-${b.id}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <RotateCcw className="w-3 h-3" />
                                )}
                              </button>
                              <button
                                onClick={() => onRestore(b.id)}
                                disabled={actionLoading !== null}
                                className="btn-ghost text-xs px-2 py-1 text-warning-500"
                                title="恢复此备份"
                              >
                                {actionLoading === `restore-${b.id}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Play className="w-3 h-3" />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expanded && (
                      <tr key={`${b.id}-detail`}>
                        <td colSpan={9} className="px-6 py-4 bg-dark-900/40 border-t border-dark-700">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <span className="text-dark-500">完整ID</span>
                              <p className="text-dark-200 font-mono text-xs mt-0.5 break-all">{b.id}</p>
                            </div>
                            <div>
                              <span className="text-dark-500">存储类型</span>
                              <p className="text-dark-200 mt-0.5">{b.storageType === "s3" ? "S3 对象存储" : "本地存储"}</p>
                            </div>
                            <div>
                              <span className="text-dark-500">Manifest路径</span>
                              <p className="text-dark-200 font-mono text-xs mt-0.5 break-all">{b.manifestPath}</p>
                            </div>
                            <div>
                              <span className="text-dark-500">校验时间</span>
                              <p className="text-dark-200 mt-0.5 text-xs">{b.verificationTime ? formatTime(b.verificationTime) : "-"}</p>
                            </div>
                          </div>
                          {b.errorMessage && (
                            <div className="mt-3 px-3 py-2 rounded-lg bg-danger-500/10 border border-danger-500/30 text-xs text-danger-500">
                              <AlertTriangle className="w-3 h-3 inline mr-1" />{b.errorMessage}
                            </div>
                          )}
                          {vr && (
                            <div className="mt-3">
                              <p className="text-dark-400 text-xs mb-2">校验详情:</p>
                              <div className="space-y-1">
                                {vr.fileChecks.map((fc) => (
                                  <div key={fc.fileName} className="flex items-center gap-2 text-xs">
                                    {fc.valid ? (
                                      <CheckCircle2 className="w-3 h-3 text-success-500" />
                                    ) : (
                                      <XCircle className="w-3 h-3 text-danger-500" />
                                    )}
                                    <span className="text-dark-200">{fc.fileName}</span>
                                    <span className="text-dark-500 font-mono">
                                      {fc.actualSha256.slice(0, 12)}...
                                    </span>
                                  </div>
                                ))}
                                <div className="flex items-center gap-2 text-xs">
                                  {vr.chainValid ? (
                                    <CheckCircle2 className="w-3 h-3 text-success-500" />
                                  ) : (
                                    <XCircle className="w-3 h-3 text-danger-500" />
                                  )}
                                  <span className="text-dark-200">哈希链完整性</span>
                                </div>
                              </div>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ScheduleTab({
  schedule,
  retention,
  onToggleScheduler,
  onUpdateRetention,
  actionLoading,
}: {
  schedule: BackupScheduleConfig & { running?: boolean; nextFullBackupTime?: string; nextIncrementalBackupTime?: string } | null;
  retention: RetentionPolicy | null;
  onToggleScheduler: () => void;
  onUpdateRetention: (policy: Partial<RetentionPolicy>) => void;
  actionLoading: string | null;
}) {
  const [editingRetention, setEditingRetention] = useState<RetentionPolicy | null>(null);

  useEffect(() => {
    if (retention && !editingRetention) {
      setEditingRetention(retention);
    }
  }, [retention, editingRetention]);

  const handleSaveRetention = () => {
    if (!editingRetention) return;
    onUpdateRetention(editingRetention);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-brand-400" />
            调度配置
          </h3>
          <button
            onClick={onToggleScheduler}
            disabled={actionLoading !== null}
            className={schedule?.running ? "btn-danger text-sm" : "btn-success text-sm"}
          >
            {actionLoading === "toggle-scheduler" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : schedule?.running ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {schedule?.running ? "停止调度" : "启动调度"}
          </button>
        </div>

        {schedule && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="px-4 py-3 rounded-lg bg-dark-900/40">
                <p className="text-dark-500 text-xs mb-1">状态</p>
                <p className="text-white font-semibold flex items-center gap-2">
                  {schedule.running ? (
                    <><span className="w-2 h-2 rounded-full bg-success-500 animate-pulse" /> 运行中</>
                  ) : (
                    <><span className="w-2 h-2 rounded-full bg-dark-500" /> 已停止</>
                  )}
                </p>
              </div>
              <div className="px-4 py-3 rounded-lg bg-dark-900/40">
                <p className="text-dark-500 text-xs mb-1">自动清理</p>
                <p className="text-white font-semibold">{schedule.autoCleanup ? "已启用" : "已关闭"}</p>
              </div>
            </div>

            <div className="px-4 py-3 rounded-lg bg-dark-900/40">
              <p className="text-dark-500 text-xs mb-1">全量备份 Cron</p>
              <p className="text-brand-400 font-mono text-sm">{schedule.fullBackupCron}</p>
              <p className="text-dark-500 text-xs mt-1">
                下次执行: {schedule.nextFullBackupTime ? formatTime(schedule.nextFullBackupTime) : "-"}
              </p>
            </div>

            <div className="px-4 py-3 rounded-lg bg-dark-900/40">
              <p className="text-dark-500 text-xs mb-1">增量备份 Cron</p>
              <p className="text-brand-400 font-mono text-sm">{schedule.incrementalBackupCron}</p>
              <p className="text-dark-500 text-xs mt-1">
                下次执行: {schedule.nextIncrementalBackupTime ? formatTime(schedule.nextIncrementalBackupTime) : "-"}
              </p>
            </div>

            <div className="px-4 py-3 rounded-lg bg-brand-500/5 border border-brand-500/20">
              <p className="text-dark-400 text-xs mb-1">策略说明</p>
              <p className="text-dark-200 text-sm leading-relaxed">
                默认策略：每日凌晨 2:00 执行全量备份，每小时整点执行增量备份。
                全量备份保留 30 天，小时增量保留 48 个，周备份保留 12 周，月备份保留 24 个月。
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-brand-400" />
            保留策略
          </h3>
          <button
            onClick={handleSaveRetention}
            className="btn-primary text-sm"
          >
            <Save className="w-4 h-4" />
            保存
          </button>
        </div>

        {editingRetention && (
          <div className="space-y-4">
            <div>
              <label className="label">保留小时增量数</label>
              <input
                type="number"
                value={editingRetention.keepHourlyBackups}
                onChange={(e) => setEditingRetention({ ...editingRetention, keepHourlyBackups: Number(e.target.value) })}
                className="input"
                min={1}
              />
            </div>
            <div>
              <label className="label">保留每日备份数</label>
              <input
                type="number"
                value={editingRetention.keepDailyBackups}
                onChange={(e) => setEditingRetention({ ...editingRetention, keepDailyBackups: Number(e.target.value) })}
                className="input"
                min={1}
              />
            </div>
            <div>
              <label className="label">保留周备份数</label>
              <input
                type="number"
                value={editingRetention.keepWeeklyBackups}
                onChange={(e) => setEditingRetention({ ...editingRetention, keepWeeklyBackups: Number(e.target.value) })}
                className="input"
                min={1}
              />
            </div>
            <div>
              <label className="label">保留月备份数</label>
              <input
                type="number"
                value={editingRetention.keepMonthlyBackups}
                onChange={(e) => setEditingRetention({ ...editingRetention, keepMonthlyBackups: Number(e.target.value) })}
                className="input"
                min={1}
              />
            </div>
            <div>
              <label className="label">最小保留天数</label>
              <input
                type="number"
                value={editingRetention.minBackupAgeDays}
                onChange={(e) => setEditingRetention({ ...editingRetention, minBackupAgeDays: Number(e.target.value) })}
                className="input"
                min={0}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RestoreTab({
  backups,
  restoreResult,
  restoreTargetId,
  setRestoreTargetId,
  findPointTime,
  setFindPointTime,
  foundBackup,
  onFindPoint,
  onDrill,
  onRestore,
  onDryRun,
  actionLoading,
}: {
  backups: BackupRecord[];
  restoreResult: RestoreResult | null;
  restoreTargetId: string;
  setRestoreTargetId: (id: string) => void;
  findPointTime: string;
  setFindPointTime: (time: string) => void;
  foundBackup: BackupRecord | null;
  onFindPoint: () => void;
  onDrill: () => void;
  onRestore: (id: string) => void;
  onDryRun: (id: string) => void;
  actionLoading: string | null;
}) {
  const completedBackups = backups.filter((b) => b.status === "completed");

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h3 className="font-semibold text-white flex items-center gap-2 mb-5">
            <RotateCcw className="w-4 h-4 text-brand-400" />
            一键恢复演练
          </h3>
          <p className="text-dark-400 text-sm mb-4">
            恢复演练将自动选择最新备份，恢复到临时目录并验证数据完整性，不会影响当前生产数据。
          </p>
          <button
            onClick={() => onDrill()}
            disabled={actionLoading !== null}
            className="btn-primary w-full"
          >
            {actionLoading === "drill" ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RotateCcw className="w-4 h-4" />
            )}
            执行恢复演练
          </button>
        </div>

        <div className="card p-5">
          <h3 className="font-semibold text-white flex items-center gap-2 mb-5">
            <Clock className="w-4 h-4 text-brand-400" />
            时间点恢复
          </h3>
          <p className="text-dark-400 text-sm mb-4">
            输入目标时间，系统将自动查找最近的可用备份点。
          </p>
          <div className="space-y-3">
            <input
              type="datetime-local"
              value={findPointTime}
              onChange={(e) => setFindPointTime(e.target.value)}
              className="input"
            />
            <button
              onClick={onFindPoint}
              disabled={actionLoading !== null || !findPointTime}
              className="btn-secondary w-full"
            >
              {actionLoading === "find" ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Clock className="w-4 h-4" />
              )}
              查找备份点
            </button>
          </div>
          {foundBackup && (
            <div className="mt-4 px-4 py-3 rounded-lg bg-success-500/10 border border-success-500/30">
              <p className="text-success-500 text-sm font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                找到备份点
              </p>
              <p className="text-dark-300 text-xs mt-1">
                ID: {foundBackup.id.slice(0, 24)}... · 类型: {foundBackup.type === "full" ? "全量" : "增量"} · 时间: {formatTime(foundBackup.timestamp)}
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onDryRun(foundBackup.id)}
                  disabled={actionLoading !== null}
                  className="btn-secondary text-xs"
                >
                  预恢复
                </button>
                <button
                  onClick={() => onRestore(foundBackup.id)}
                  disabled={actionLoading !== null}
                  className="btn-danger text-xs"
                >
                  确认恢复
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold text-white flex items-center gap-2 mb-5">
          <Database className="w-4 h-4 text-brand-400" />
          指定备份恢复
        </h3>
        <div className="space-y-4">
          <div>
            <label className="label">选择备份</label>
            <select
              value={restoreTargetId}
              onChange={(e) => setRestoreTargetId(e.target.value)}
              className="input"
            >
              <option value="">-- 请选择备份 --</option>
              {completedBackups.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.type === "full" ? "[全量]" : "[增量]"} {b.id.slice(0, 24)}... ({formatTime(b.timestamp)} - {formatBytes(b.totalSize)})
                </option>
              ))}
            </select>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => restoreTargetId && onDryRun(restoreTargetId)}
              disabled={actionLoading !== null || !restoreTargetId}
              className="btn-secondary"
            >
              {actionLoading === `dryrun-${restoreTargetId}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileCheck className="w-4 h-4" />
              )}
              预恢复（不写入）
            </button>
            <button
              onClick={() => restoreTargetId && onRestore(restoreTargetId)}
              disabled={actionLoading !== null || !restoreTargetId}
              className="btn-danger"
            >
              {actionLoading === `restore-${restoreTargetId}` ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Play className="w-4 h-4" />
              )}
              确认恢复
            </button>
          </div>
        </div>
      </div>

      {restoreResult && (
        <div className={`card p-5 ${
          restoreResult.status === "completed" || restoreResult.status === "dry_run"
            ? "border-success-500/30"
            : "border-danger-500/30"
        }`}>
          <h3 className="font-semibold text-white flex items-center gap-2 mb-4">
            {restoreResult.status === "completed" || restoreResult.status === "dry_run" ? (
              <CheckCircle2 className="w-4 h-4 text-success-500" />
            ) : (
              <XCircle className="w-4 h-4 text-danger-500" />
            )}
            恢复结果
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-dark-500">状态</span>
              <p className="mt-0.5"><StatusTag status={restoreResult.status} /></p>
            </div>
            <div>
              <span className="text-dark-500">模式</span>
              <p className="text-white mt-0.5">{restoreResult.dryRun ? "预演模式" : "实际恢复"}</p>
            </div>
            <div>
              <span className="text-dark-500">耗时</span>
              <p className="text-white mt-0.5">{formatDuration(restoreResult.durationMs)}</p>
            </div>
            <div>
              <span className="text-dark-500">恢复文件数</span>
              <p className="text-white mt-0.5">{restoreResult.restoredFiles.length}</p>
            </div>
          </div>
          {restoreResult.restoredFiles.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {restoreResult.restoredFiles.map((f) => (
                <span key={f} className="tag-blue">{f}</span>
              ))}
            </div>
          )}
          {restoreResult.errorMessage && (
            <div className="mt-3 px-3 py-2 rounded-lg bg-danger-500/10 border border-danger-500/30 text-xs text-danger-500">
              <AlertTriangle className="w-3 h-3 inline mr-1" />{restoreResult.errorMessage}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
