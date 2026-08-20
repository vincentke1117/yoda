import type { TFunction } from 'i18next';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import { rpcErrorMessage } from '@renderer/lib/rpc-error';
import { log } from '@renderer/utils/logger';

/**
 * Publish the task's session as a public read-only link and copy it. Shared by
 * every surface that offers the action, so the toasts (including the
 * copy-diagnostics affordance on failure) stay identical.
 */
export async function shareTaskSessionPublicly(
  projectId: string,
  taskId: string,
  conversationId: string,
  t: TFunction
): Promise<void> {
  const toastId = toast.loading(t('tasks.tabs.creatingPublicShare'));
  try {
    const share = await rpc.sessionShares.create(projectId, taskId, conversationId);
    const copied = await rpc.app.clipboardWriteText(share.url);
    toast.success(
      t(copied.success ? 'tasks.tabs.publicShareCopied' : 'tasks.tabs.publicShareCreated'),
      {
        id: toastId,
        description:
          share.omittedAssetCount > 0
            ? t('tasks.tabs.publicShareAssetsPartial', {
                uploaded: share.assetCount,
                omitted: share.omittedAssetCount,
              })
            : share.assetCount > 0
              ? t('tasks.tabs.publicShareAssetsUploaded', { count: share.assetCount })
              : copied.success
                ? undefined
                : t('tasks.tabs.publicShareCopyFailed'),
        action: {
          label: t('common.open'),
          onClick: () => void rpc.app.openExternal(share.url),
        },
      }
    );
  } catch (error) {
    log.warn('shareTaskSessionPublicly: create public session share failed', {
      projectId,
      taskId,
      conversationId,
      error,
    });

    // Show the server's own reason (it carries the HTTP status and error code) instead
    // of guessing at sign-in or empty history — those were only ever two of the causes.
    const reason = rpcErrorMessage(error);
    toast.error(t('tasks.tabs.publicShareFailed'), {
      id: toastId,
      description: reason || t('tasks.tabs.publicShareFailedDescription'),
      action: {
        label: t('common.copy'),
        onClick: () => {
          void rpc.app.clipboardWriteText(
            [
              reason || t('tasks.tabs.publicShareFailedDescription'),
              `project: ${projectId}`,
              `task: ${taskId}`,
              `session: ${conversationId}`,
            ].join('\n')
          );
        },
      },
    });
  }
}
