import { z } from 'zod';

export const createMaintenanceWindowInputSchema = z
  .object({
    title: z.string().min(1),
    message: z.string().min(1).optional(),
    starts_at: z.number().int(),
    ends_at: z.number().int(),
    monitor_ids: z.array(z.number().int().positive()).min(1),
  })
  .superRefine((val, ctx) => {
    if (val.starts_at >= val.ends_at) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`starts_at` must be less than `ends_at`',
        path: ['starts_at'],
      });
    }
  });

export type CreateMaintenanceWindowInput = z.infer<typeof createMaintenanceWindowInputSchema>;

export const patchMaintenanceWindowInputSchema = z
  .object({
    title: z.string().min(1).optional(),
    message: z.string().min(1).nullable().optional(),
    starts_at: z.number().int().optional(),
    ends_at: z.number().int().optional(),
    monitor_ids: z.array(z.number().int().positive()).min(1).optional(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: 'At least one field must be provided',
  });

export type PatchMaintenanceWindowInput = z.infer<typeof patchMaintenanceWindowInputSchema>;
