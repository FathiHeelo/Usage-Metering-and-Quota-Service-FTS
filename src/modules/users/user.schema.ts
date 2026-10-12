import { z } from "zod";

export const createUserSchema = z
  .object({
    externalUserId: z.string().trim().min(1),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const changeUserPlanParamsSchema = z.object({
  externalUserId: z.string().trim().min(1),
});

export const changeUserPlanBodySchema = z
  .object({
    planId: z.uuid(),
  })
  .strict();

export type ChangeUserPlanInput = z.infer<typeof changeUserPlanBodySchema>;
