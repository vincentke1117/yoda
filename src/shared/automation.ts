import { z } from 'zod';
import { RUNTIME_IDS } from './runtime-registry';

export const automationStatusSchema = z.enum(['active', 'paused']);
export type AutomationStatus = z.infer<typeof automationStatusSchema>;

/** A saved automation: a recurring prompt the user can run as an agent task. */
export const automationSchema = z.object({
  id: z.string(),
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  runtime: z.enum(RUNTIME_IDS),
  scheduleLabel: z.string(),
  status: automationStatusSchema,
  lastRunAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Automation = z.infer<typeof automationSchema>;

export const automationCreateInputSchema = z.object({
  title: z.string(),
  workspaceName: z.string(),
  prompt: z.string(),
  runtime: z.enum(RUNTIME_IDS),
  scheduleLabel: z.string().default(''),
  status: automationStatusSchema.default('active'),
});
export type AutomationCreateInput = z.infer<typeof automationCreateInputSchema>;

export const automationUpdateInputSchema = z
  .object({
    title: z.string(),
    workspaceName: z.string(),
    prompt: z.string(),
    runtime: z.enum(RUNTIME_IDS),
    scheduleLabel: z.string(),
    status: automationStatusSchema,
    lastRunAt: z.string().nullable(),
  })
  .partial();
export type AutomationUpdateInput = z.infer<typeof automationUpdateInputSchema>;
