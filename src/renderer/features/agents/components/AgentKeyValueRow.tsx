import React from 'react';
import { useTranslation } from 'react-i18next';

export const AgentKeyValueRow: React.FC<{ label: string; value?: string | null }> = ({
  label,
  value,
}) => {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {value ? (
        <code className="rounded bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
          {value}
        </code>
      ) : (
        <span className="italic text-muted-foreground/60">{t('agents.unset')}</span>
      )}
    </div>
  );
};
