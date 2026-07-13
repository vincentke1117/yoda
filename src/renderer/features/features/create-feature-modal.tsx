import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Feature } from '@shared/features';
import type { Issue } from '@shared/tasks';
import { IssueIdentifier } from '@renderer/features/tasks/components/issue-selector/issue-selector';
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
import { Textarea } from '@renderer/lib/ui/textarea';
import { useCreateFeature } from './use-features';

type Props = BaseModalProps<Feature> & {
  projectId: string;
  sourceIssue?: Issue;
};

export function CreateFeatureModal({ projectId, sourceIssue, onSuccess, onClose }: Props) {
  const { t } = useTranslation();
  const createFeature = useCreateFeature();
  const [title, setTitle] = useState(sourceIssue?.title ?? '');
  const [problem, setProblem] = useState(
    sourceIssue?.description?.trim() || sourceIssue?.title || ''
  );
  const [outcome, setOutcome] = useState('');
  const [nonGoals, setNonGoals] = useState('');
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && problem.trim().length > 0;

  const submit = async () => {
    if (!canSubmit || createFeature.isPending) return;
    setError(null);
    try {
      const feature = await createFeature.mutateAsync({
        projectId,
        title,
        problem,
        outcome,
        nonGoals,
        sourceIssues: sourceIssue ? [sourceIssue] : [],
      });
      onSuccess(feature);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('featureDelivery.createFailed'));
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('featureDelivery.createTitle')}</DialogTitle>
      </DialogHeader>
      <DialogContentArea className="gap-5">
        {sourceIssue ? (
          <div className="flex items-center gap-2 rounded-md border border-border bg-background-2 px-3 py-2 text-xs text-foreground-muted">
            <span className="font-mono uppercase tracking-[0.14em] text-foreground-passive">
              {t('featureDelivery.sourceIssue')}
            </span>
            <IssueIdentifier identifier={sourceIssue.identifier} />
            <span className="min-w-0 truncate text-foreground">{sourceIssue.title}</span>
          </div>
        ) : null}
        <FieldGroup>
          <Field>
            <FieldLabel>{t('featureDelivery.fields.title')}</FieldLabel>
            <Input
              data-autofocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder={t('featureDelivery.fields.titlePlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel>{t('featureDelivery.fields.problem')}</FieldLabel>
            <Textarea
              value={problem}
              onChange={(event) => setProblem(event.target.value)}
              placeholder={t('featureDelivery.fields.problemPlaceholder')}
              rows={4}
            />
            <FieldDescription>{t('featureDelivery.fields.problemHint')}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>{t('featureDelivery.fields.outcome')}</FieldLabel>
            <Textarea
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder={t('featureDelivery.fields.outcomePlaceholder')}
              rows={2}
            />
          </Field>
          <Field>
            <FieldLabel>{t('featureDelivery.fields.nonGoals')}</FieldLabel>
            <Textarea
              value={nonGoals}
              onChange={(event) => setNonGoals(event.target.value)}
              placeholder={t('featureDelivery.fields.nonGoalsPlaceholder')}
              rows={2}
            />
          </Field>
        </FieldGroup>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </DialogContentArea>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <ConfirmButton
          disabled={!canSubmit || createFeature.isPending}
          onClick={() => void submit()}
        >
          {createFeature.isPending ? t('featureDelivery.creating') : t('featureDelivery.create')}
        </ConfirmButton>
      </DialogFooter>
    </>
  );
}
