import { Plus, Trash2, Webhook } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { KanbanColumnHook, KanbanHookAction } from '@shared/app-settings';
import type { KanbanStatus } from '@shared/kanban';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { Button } from '@renderer/lib/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { Switch } from '@renderer/lib/ui/switch';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';

type HookType = KanbanHookAction['type'];

const HOOK_TYPE_LABEL_KEYS: Record<HookType, string> = {
  prompt: 'kanban.hooks.typePrompt',
  command: 'kanban.hooks.typeCommand',
  notify: 'kanban.hooks.typeNotify',
};

const HOOK_VALUE_PLACEHOLDER_KEYS: Record<HookType, string> = {
  prompt: 'kanban.hooks.promptPlaceholder',
  command: 'kanban.hooks.commandPlaceholder',
  notify: 'kanban.hooks.notifyPlaceholder',
};

function actionValue(action: KanbanHookAction): string {
  switch (action.type) {
    case 'prompt':
      return action.text;
    case 'command':
      return action.command;
    case 'notify':
      return action.message;
  }
}

function makeAction(type: HookType, value: string): KanbanHookAction {
  switch (type) {
    case 'prompt':
      return { type, text: value };
    case 'command':
      return { type, command: value };
    case 'notify':
      return { type, message: value };
  }
}

export function ColumnHooksPopover({ status }: { status: KanbanStatus }) {
  const { t } = useTranslation();
  const { value, update } = useAppSettingsKey('kanban');
  const hooks = value?.hooksByStatus?.[status] ?? [];

  const setHooks = (next: KanbanColumnHook[]) => {
    update({ hooksByStatus: { ...(value?.hooksByStatus ?? {}), [status]: next } });
  };

  const patchHook = (id: string, patch: Partial<KanbanColumnHook>) => {
    setHooks(hooks.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)));
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={t('kanban.hooks.title')}
        className={cn(
          'relative flex size-6 items-center justify-center rounded-md text-foreground-tertiary-passive transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary',
          hooks.length > 0 && 'text-foreground-tertiary'
        )}
      >
        <Webhook className="size-3.5" />
        {hooks.some((hook) => hook.enabled) && (
          <span className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-status-in-progress" />
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-sm font-medium text-foreground">{t('kanban.hooks.title')}</div>
            <div className="text-xs text-foreground-tertiary-passive">
              {t('kanban.hooks.description')}
            </div>
          </div>

          {hooks.map((hook) => (
            <div
              key={hook.id}
              className="flex flex-col gap-1.5 rounded-md border border-border p-2"
            >
              <div className="flex items-center gap-2">
                <Select
                  value={hook.action.type}
                  onValueChange={(type) =>
                    patchHook(hook.id, {
                      action: makeAction(type as HookType, actionValue(hook.action)),
                    })
                  }
                >
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(HOOK_TYPE_LABEL_KEYS) as HookType[]).map((type) => (
                      <SelectItem key={type} value={type} className="text-xs">
                        {t(HOOK_TYPE_LABEL_KEYS[type])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Switch
                  checked={hook.enabled}
                  onCheckedChange={(enabled) => patchHook(hook.id, { enabled })}
                  aria-label={t('kanban.hooks.enabled')}
                />
                <button
                  type="button"
                  aria-label={t('kanban.hooks.remove')}
                  onClick={() => setHooks(hooks.filter((other) => other.id !== hook.id))}
                  className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-tertiary-passive transition-colors hover:bg-background-tertiary-1 hover:text-foreground-tertiary"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <Textarea
                value={actionValue(hook.action)}
                onChange={(e) =>
                  patchHook(hook.id, { action: makeAction(hook.action.type, e.target.value) })
                }
                placeholder={t(HOOK_VALUE_PLACEHOLDER_KEYS[hook.action.type])}
                rows={2}
                className="min-h-0 text-xs"
              />
            </div>
          ))}

          {hooks.length === 0 && (
            <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-foreground-tertiary-passive">
              {t('kanban.hooks.empty')}
            </div>
          )}

          <Button
            variant="outline"
            size="sm"
            className="justify-center"
            onClick={() =>
              setHooks([
                ...hooks,
                { id: crypto.randomUUID(), enabled: true, action: { type: 'prompt', text: '' } },
              ])
            }
          >
            <Plus className="size-3.5" />
            {t('kanban.hooks.add')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
