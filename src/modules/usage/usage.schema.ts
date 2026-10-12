import { z } from "zod";

export const consumeUsageSchema = z
  .object({
    userId: z.string().trim().min(1),
    units: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().trim().min(1),
  })
  .strict();

export type ConsumeUsageInput = z.infer<typeof consumeUsageSchema>;

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const usageMonthQuerySchema = z
  .object({
    month: monthSchema.optional(),
  })
  .strict();

export const userUsageParamsSchema = z.object({
  externalUserId: z.string().trim().min(1),
});

export const usageHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    externalUserId: z.string().trim().min(1).optional(),
    status: z.enum(["ACCEPTED", "REJECTED"]).optional(),
    month: monthSchema.optional(),
  })
  .strict();

export type UsageMonthQuery = z.infer<typeof usageMonthQuerySchema>;
export type UsageHistoryQuery = z.infer<typeof usageHistoryQuerySchema>;
