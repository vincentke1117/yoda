import { CircleUserRound, Coins } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { accountDisplayName } from '@renderer/lib/account-display';
import { useAccountCommerce, useAccountSession } from '@renderer/lib/hooks/useAccount';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';

export function SidebarAccountAnchor() {
  const { t } = useTranslation();
  const { navigate } = useNavigate();
  const { data: session, isLoading } = useAccountSession();
  const user = session?.isSignedIn ? session.user : null;
  const commerce = useAccountCommerce(user?.userId, Boolean(user));
  const displayName = user ? accountDisplayName(user) : t('sidebar.lovStudioAccount');
  const subtitle = isLoading
    ? t('common.loading')
    : user
      ? user.email
      : session?.hasAccount
        ? t('sidebar.accountSignInRequired')
        : t('sidebar.accountLocalMode');

  return (
    <button
      type="button"
      onClick={() => navigate('settings', { tab: 'account' })}
      className="group/account flex min-h-14 w-full min-w-0 items-center gap-2.5 rounded-2xl border border-border/60 bg-background-tertiary-1/70 px-3 py-2.5 text-left text-foreground-tertiary-muted shadow-[0_1px_0_rgb(255_255_255_/_0.04)] transition-[background-color,border-color,box-shadow,transform] hover:-translate-y-px hover:border-border hover:bg-background-tertiary-2/80 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={t('sidebar.manageLovStudioAccount')}
      title={t('sidebar.manageLovStudioAccount')}
    >
      {user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="size-8 shrink-0 rounded-full border border-border/70 object-cover shadow-sm"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border/70 bg-background-tertiary-2 shadow-sm">
          <CircleUserRound className="size-[17px]" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium leading-4 text-foreground-tertiary">
          {displayName}
        </span>
        <span className="mt-0.5 block truncate text-[10px] leading-3 text-foreground-tertiary-passive">
          {subtitle}
        </span>
      </span>
      {commerce.data ? (
        <span className="flex shrink-0 items-center gap-1 rounded-full border border-border/60 bg-background-tertiary px-2 py-1 text-[10px] tabular-nums text-foreground-tertiary-passive transition-colors group-hover/account:text-foreground-tertiary-muted">
          <Coins className="size-3" />
          {commerce.data.credits.balance}
        </span>
      ) : null}
    </button>
  );
}
