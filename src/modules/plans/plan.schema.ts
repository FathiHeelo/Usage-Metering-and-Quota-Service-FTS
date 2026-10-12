import { z } from "zod";

const quotaLimitSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const createPlanSchema = z
  .object({
    name: z.string().trim().min(1),
    scope: z.enum(["ACCOUNT", "USER"]),
    monthlyAllowance: quotaLimitSchema,
    maxUnitsPerRequest: quotaLimitSchema,
  })
  .strict();

export const updatePlanParamsSchema = z.object({
  planId: z.uuid(),
});

export const updatePlanSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    monthlyAllowance: quotaLimitSchema.optional(),
    maxUnitsPerRequest: quotaLimitSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export type CreatePlanInput = z.infer<typeof createPlanSchema>;
export type UpdatePlanInput = z.infer<typeof updatePlanSchema>;
