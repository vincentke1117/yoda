import { action, computed, makeObservable, observable, runInAction } from 'mobx';
import { menuCheckForUpdatesChannel } from '@shared/events/appEvents';
import {
  updateAvailableEvent,
  updateCheckingEvent,
  updateDownloadedEvent,
  updateDownloadingEvent,
  updateErrorEvent,
  updateInstallingEvent,
  updateNotAvailableEvent,
  updateProgressEvent,
} from '@shared/events/updateEvents';
import type { UpdateState as UpdateServiceState } from '@main/core/updates/update-service';
import { toast } from '@renderer/lib/hooks/use-toast';
import i18n from '@renderer/lib/i18n';
import { events, rpc } from '@renderer/lib/ipc';

const LAST_NOTIFIED_KEY = 'yoda:update:lastNotified';
const SNOOZE_HOURS = 6;

type DownloadProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

type CheckOptions = {
  notify?: boolean;
};

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info?: { version: string } }
  | { status: 'not-available' }
  | { status: 'downloading'; progress?: DownloadProgress }
  | { status: 'downloaded' }
  | { status: 'installing' }
  | { status: 'error'; message: string };

export class UpdateStore {
  state: UpdateState = { status: 'idle' };
  currentVersion = '';
  availableVersion: string | undefined = undefined;
  private manualCheckToastId: string | number | undefined = undefined;

  constructor() {
    makeObservable(this, {
      state: observable,
      currentVersion: observable,
      availableVersion: observable,
      setState: action,
      hasUpdate: computed,
      progressLabel: computed,
    });
  }

  get hasUpdate(): boolean {
    const { status } = this.state;
    return status === 'available' || status === 'downloading' || status === 'downloaded';
  }

  setState(state: UpdateState): void {
    this.state = state;
  }

  get progressLabel(): string {
    if (this.state.status !== 'downloading') return '';
    const p = this.state.progress?.percent ?? 0;
    return `${p.toFixed(0)}%`;
  }

  start(): void {
    void rpc.app.getAppVersion().then((v) => {
      runInAction(() => {
        this.currentVersion = v;
      });
    });

    events.on(updateCheckingEvent, () => {
      runInAction(() => {
        this.state = { status: 'checking' };
      });
    });

    events.on(updateAvailableEvent, (d) => {
      runInAction(() => {
        this.availableVersion = d.version;
        this.state = { status: 'available', info: { version: d.version } };
      });
      if (this.manualCheckToastId === undefined) {
        this._maybeToastAvailable(d.version);
      }
    });

    events.on(updateNotAvailableEvent, () => {
      runInAction(() => {
        this.state = { status: 'not-available' };
      });
    });

    events.on(updateDownloadingEvent, (_d) => {
      runInAction(() => {
        this.state = { status: 'downloading', progress: { percent: 0 } };
      });
    });

    events.on(updateProgressEvent, (d) => {
      runInAction(() => {
        this.state = {
          status: 'downloading',
          progress: {
            percent: d.percent,
            transferred: d.transferred,
            total: d.total,
            bytesPerSecond: d.bytesPerSecond,
          },
        };
      });
    });

    events.on(updateDownloadedEvent, () => {
      runInAction(() => {
        this.state = { status: 'downloaded' };
      });
    });

    events.on(updateInstallingEvent, () => {
      runInAction(() => {
        this.state = { status: 'installing' };
      });
    });

    events.on(updateErrorEvent, (d) => {
      runInAction(() => {
        this.state = { status: 'error', message: d.message };
      });
    });

    events.on(menuCheckForUpdatesChannel, () => {
      void this.check({ notify: true });
    });

    rpc.update.check().catch(() => {});
  }

  async check(options: CheckOptions = {}): Promise<void> {
    const toastId = options.notify ? toast.loading(i18n.t('settings.update.checking')) : undefined;
    if (toastId !== undefined) {
      this.manualCheckToastId = toastId;
    }

    runInAction(() => {
      this.state = { status: 'checking' };
    });

    try {
      const res = await rpc.update.check();
      if (!res) {
        this._setError('Update API unavailable');
        this._finishManualCheckToast(toastId);
        return;
      }
      if (!res.success) {
        this._setError(res.error ?? i18n.t('settings.update.checkFailed'));
      } else if (res.result === null) {
        this._setError(i18n.t('settings.update.unavailableInBuild'));
      } else {
        await this._syncStateAfterCheck();
        if (this.state.status === 'checking') {
          runInAction(() => {
            this.state = { status: 'not-available' };
          });
        }
      }
      this._finishManualCheckToast(toastId);
    } catch {
      this._setError(i18n.t('settings.update.checkFailed'));
      this._finishManualCheckToast(toastId);
    } finally {
      if (this.manualCheckToastId === toastId) {
        this.manualCheckToastId = undefined;
      }
    }
  }

  async download(): Promise<void> {
    try {
      const res = await rpc.update.download();
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        const message = res.error ?? 'Failed to download update';
        runInAction(() => {
          this.state = { status: 'error', message };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to download update' };
      });
    }
  }

  async install(): Promise<void> {
    runInAction(() => {
      this.state = { status: 'installing' };
    });
    try {
      const res = await rpc.update.quitAndInstall();
      if (!res) {
        runInAction(() => {
          this.state = { status: 'error', message: 'Update API unavailable' };
        });
        return;
      }
      if (!res.success) {
        runInAction(() => {
          this.state = { status: 'error', message: res.error ?? 'Failed to install update' };
        });
      }
    } catch {
      runInAction(() => {
        this.state = { status: 'error', message: 'Failed to install update' };
      });
    }
  }

  async openLatest(): Promise<void> {
    try {
      await rpc.update.openLatest();
    } catch {
      // openLatest quits the app — errors are best-effort
    }
  }

  private _maybeToastAvailable(version: string): void {
    if (!this._shouldNotify(version)) return;
    toast.success(i18n.t('settings.update.availableToast'), {
      description: i18n.t('settings.update.availableToastDescription', { version }),
    });
    this._rememberNotified(version);
  }

  private _setError(message: string): void {
    runInAction(() => {
      this.state = { status: 'error', message };
    });
  }

  private async _syncStateAfterCheck(): Promise<void> {
    const stateResult = await rpc.update.getState();
    if (!stateResult?.success || !stateResult.data) return;
    this._applyServiceState(stateResult.data, { checked: true });
  }

  private _applyServiceState(
    serviceState: UpdateServiceState,
    options: { checked?: boolean } = {}
  ): void {
    runInAction(() => {
      this.currentVersion = serviceState.currentVersion;
      switch (serviceState.status) {
        case 'idle':
          this.state = options.checked ? { status: 'not-available' } : { status: 'idle' };
          break;
        case 'checking':
          this.state = { status: 'checking' };
          break;
        case 'available': {
          const version = serviceState.availableVersion ?? serviceState.updateInfo?.version;
          this.availableVersion = version;
          this.state = version
            ? { status: 'available', info: { version } }
            : { status: 'available' };
          break;
        }
        case 'downloading':
          this.state = {
            status: 'downloading',
            progress: serviceState.downloadProgress,
          };
          break;
        case 'downloaded':
          this.state = { status: 'downloaded' };
          break;
        case 'installing':
          this.state = { status: 'installing' };
          break;
        case 'error':
          this.state = {
            status: 'error',
            message: serviceState.error ?? i18n.t('settings.update.checkFailed'),
          };
          break;
      }
    });
  }

  private _finishManualCheckToast(toastId: string | number | undefined): void {
    if (toastId === undefined) return;

    switch (this.state.status) {
      case 'available':
        toast.success(i18n.t('settings.update.availableToast'), {
          id: toastId,
          description: this.state.info?.version
            ? i18n.t('settings.update.availableToastDescription', {
                version: this.state.info.version,
              })
            : undefined,
        });
        return;
      case 'not-available':
        toast.success(i18n.t('settings.update.upToDate'), { id: toastId });
        return;
      case 'error':
        toast.error(i18n.t('settings.update.checkFailed'), {
          id: toastId,
          description: this.state.message,
        });
        return;
      default:
        toast.dismiss(toastId);
    }
  }

  private _shouldNotify(version: string): boolean {
    try {
      const raw = localStorage.getItem(LAST_NOTIFIED_KEY);
      if (!raw) return true;
      const parsed = JSON.parse(raw) as { version?: string; at?: number };
      if (parsed.version === version) {
        const at = parsed.at ?? 0;
        if (Date.now() - at < Math.max(1, SNOOZE_HOURS) * 3_600_000) return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private _rememberNotified(version: string): void {
    try {
      localStorage.setItem(LAST_NOTIFIED_KEY, JSON.stringify({ version, at: Date.now() }));
    } catch {
      // localStorage may be unavailable
    }
  }
}
