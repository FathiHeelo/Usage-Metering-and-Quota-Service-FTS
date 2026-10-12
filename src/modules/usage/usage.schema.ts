import { z } from "zod";

export const consumeUsageSchema = z
  .object({
    userId: z.string().trim().min(1),
    units: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    requestId: z.string().trim().min(1),
  })
  .strict();

export type ConsumeUsageInput = z.infer<typeof consumeUsageSchema>;
