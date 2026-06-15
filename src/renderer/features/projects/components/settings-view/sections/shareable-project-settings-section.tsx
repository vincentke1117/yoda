import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  ProjectSettingsOverrideState,
  ShareableProjectSettingsWriteField,
} from '@shared/project-settings';
import { YODA_DOCS_URL } from '@shared/urls';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Field, FieldDescription, FieldTitle } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { Separator } from '@renderer/lib/ui/separator';
import { Textarea } from '@renderer/lib/ui/textarea';
import { cn } from '@renderer/utils/utils';
import type { FormState, FormUpdate } from '../project-settings-form-model';
import { settingsFocus } from '../settings-focus';
import {
  SHAREABLE_FIELD_DESCRIPTORS,
  type ShareableFieldDescriptor,
} from '../shareable-project-settings-fields';
import { ShareableSettingTitle } from '../shareable-setting-title';

type ShareableSettingsSectionProps = {
  form: FormState;
  update: FormUpdate;
  getOverrideSources: (
    field: ShareableProjectSettingsWriteField
  ) => ProjectSettingsOverrideState[ShareableProjectSettingsWriteField];
};

function ShareableField({
  descriptor,
  form,
  update,
  getOverrideSources,
}: {
  descriptor: ShareableFieldDescriptor;
  form: FormState;
  update: FormUpdate;
  getOverrideSources: ShareableSettingsSectionProps['getOverrideSources'];
}) {
  const { t } = useTranslation();
  const fieldKey = `projects.settings.shareable.fields.${descriptor.id}`;

  return (
    <Field>
      <ShareableSettingTitle
        leafLabel={t(`${fieldKey}.leafLabel`)}
        overrideSources={getOverrideSources(descriptor.id)}
        onRestore={() => update(descriptor.formKey, '')}
      >
        {descriptor.group ? t(`${fieldKey}.leafLabel`) : t(`${fieldKey}.modalLabel`)}
      </ShareableSettingTitle>
      {descriptor.description ? (
        <FieldDescription className="text-foreground-muted">
          {t(`${fieldKey}.description`)}
        </FieldDescription>
      ) : null}
      {descriptor.multiline ? (
        <Textarea
          rows={descriptor.id === 'preservePatterns' ? 5 : 3}
          placeholder={descriptor.placeholder}
          value={form[descriptor.formKey]}
          onChange={(e) => update(descriptor.formKey, e.target.value)}
        />
      ) : (
        <Input
          placeholder={descriptor.placeholder}
          value={form[descriptor.formKey]}
          onChange={(e) => update(descriptor.formKey, e.target.value)}
        />
      )}
    </Field>
  );
}

export const ShareableSettingsSection = observer(function ShareableSettingsSection({
  form,
  update,
  getOverrideSources,
}: ShareableSettingsSectionProps) {
  const { t } = useTranslation();
  const topLevelFields = SHAREABLE_FIELD_DESCRIPTORS.filter((descriptor) => !descriptor.group);
  const lifecycleFields = SHAREABLE_FIELD_DESCRIPTORS.filter(
    (descriptor) => descriptor.group === 'lifecycle'
  );
  const docsFields = SHAREABLE_FIELD_DESCRIPTORS.filter(
    (descriptor) => descriptor.group === 'docs'
  );

  // Deep links into settings (e.g. the Docs page's "configure" empty state)
  // request a focus target; scroll the docs group into view, flash a highlight,
  // and focus its first input, then consume the one-shot request.
  const docsRef = useRef<HTMLDivElement>(null);
  const [docsHighlight, setDocsHighlight] = useState(false);
  const focusTarget = settingsFocus.target;
  useEffect(() => {
    if (focusTarget !== 'docs') return;
    settingsFocus.consume();
    const el = docsRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.querySelector<HTMLElement>('input, textarea')?.focus({ preventScroll: true });
    setDocsHighlight(true);
    const timer = setTimeout(() => setDocsHighlight(false), 1600);
    return () => clearTimeout(timer);
  }, [focusTarget]);

  return (
    <>
      <Separator />

      {topLevelFields.map((descriptor) => (
        <ShareableField
          key={descriptor.id}
          descriptor={descriptor}
          form={form}
          update={update}
          getOverrideSources={getOverrideSources}
        />
      ))}

      <Separator />

      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <FieldTitle>{t('projects.settings.lifecycleScripts')}</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            {t('projects.settings.lifecycleScriptsDescription')}
            <span> {t('common.see')} </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              className="group inline-flex h-auto cursor-pointer items-center gap-1 px-0 text-sm font-normal text-muted-foreground hover:text-foreground hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() => rpc.app.openExternal(`${YODA_DOCS_URL}/project-config`)}
            >
              <span className="font-mono text-xs transition-colors group-hover:text-foreground">
                {t('projects.settings.docs')}
              </span>
              <span className="text-sm text-muted-foreground transition-colors group-hover:text-foreground">
                ↗
              </span>
            </Button>
            <span> {t('projects.settings.fullConfigReference')}</span>
          </FieldDescription>
        </div>

        {lifecycleFields.map((descriptor) => (
          <ShareableField
            key={descriptor.id}
            descriptor={descriptor}
            form={form}
            update={update}
            getOverrideSources={getOverrideSources}
          />
        ))}
      </div>

      <Separator />

      <div
        ref={docsRef}
        className={cn(
          '-mx-3 flex scroll-mt-6 flex-col gap-4 rounded-lg px-3 py-3 transition-colors duration-500',
          docsHighlight ? 'bg-primary/5 ring-1 ring-primary/40' : 'ring-1 ring-transparent'
        )}
      >
        <div className="flex flex-col gap-1">
          <FieldTitle>{t('projects.settings.docsSection')}</FieldTitle>
          <FieldDescription className="text-foreground-muted">
            {t('projects.settings.docsSectionDescription')}
          </FieldDescription>
        </div>

        {docsFields.map((descriptor) => (
          <ShareableField
            key={descriptor.id}
            descriptor={descriptor}
            form={form}
            update={update}
            getOverrideSources={getOverrideSources}
          />
        ))}
      </div>
    </>
  );
});
