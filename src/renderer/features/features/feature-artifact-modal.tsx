import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  featureArtifactStatusIds,
  featureArtifactTypes,
  type Feature,
  type FeatureArtifactStatus,
  type FeatureArtifactType,
} from '@shared/features';
import { type BaseModalProps } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ConfirmButton } from '@renderer/lib/ui/confirm-button';
import {
  DialogContentArea,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@renderer/lib/ui/dialog';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@renderer/lib/ui/field';
import { Input } from '@renderer/lib/ui/input';
import { useFeatureMutations } from './use-features';

type Props = BaseModalProps<Feature> & {
  projectId: string;
  featureId: string;
  suggestedType?: FeatureArtifactType;
};

const SELECT_CLASS =
  'h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm text-foreground outline-none transition-colors hover:border-border-1 focus:border-border-primary focus:ring-2 focus:ring-primary/30';

export function FeatureArtifactModal({
  projectId,
  featureId,
  suggestedType = 'product_spec',
  onSuccess,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const mutations = useFeatureMutations(projectId, featureId);
  const [type, setType] = useState<FeatureArtifactType>(suggestedType);
  const [title, setTitle] = useState(() => t(`featureDelivery.artifactTypes.${suggestedType}`));
  const [uri, setUri] = useState('');
  const [status, setStatus] = useState<FeatureArtifactStatus>('draft');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && uri.trim().length > 0;
  const submit = async () => {
    if (!canSubmit || mutations.addArtifact.isPending) return;
    setError(null);
    try {
      const result = await mutations.addArtifact.mutateAsync({ type, title, uri, status });
      if (!result.success) {
        setError(t('featureDelivery.artifactCreateFailed'));
        return;
      }
      onSuccess(result.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('featureDelivery.artifactCreateFailed'));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('featureDelivery.artifacts.add')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea>
        <FieldGroup>
          <Field>
            <FieldLabel>{t('featureDelivery.artifacts.type')}</FieldLabel>
            <select
              className={SELECT_CLASS}
              value={type}
              onChange={(event) => {
                const nextType = event.target.value as FeatureArtifactType;
                setType(nextType);
                setTitle(t(`featureDelivery.artifactTypes.${nextType}`));
              }}
            >
              {featureArtifactTypes.map((artifactType) => (
                <option key={artifactType} value={artifactType}>
                  {t(`featureDelivery.artifactTypes.${artifactType}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field>
            <FieldLabel>{t('featureDelivery.artifacts.title')}</FieldLabel>
            <Input
              data-autofocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>{t('featureDelivery.artifacts.uri')}</FieldLabel>
            <Input
              value={uri}
              onChange={(event) => setUri(event.target.value)}
              placeholder={t('featureDelivery.artifacts.uriPlaceholder')}
            />
            <FieldDescription>{t('featureDelivery.artifacts.uriHint')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t('featureDelivery.artifacts.status')}</FieldLabel>
            <select
              className={SELECT_CLASS}
              value={status}
              onChange={(event) => setStatus(event.target.value as FeatureArtifactStatus)}
            >
              {featureArtifactStatusIds.map((artifactStatus) => (
                <option key={artifactStatus} value={artifactStatus}>
                  {t(`featureDelivery.artifactStatuses.${artifactStatus}`)}
                </option>
              ))}
            </select>
          </Field>
        </FieldGroup>
        {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          disabled={!canSubmit || mutations.addArtifact.isPending}
          onClick={() => void submit()}
        >
          {t('featureDelivery.artifacts.add')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
