import { z } from "zod";

export const createAccountSchema = z.object({
  name: z.string().trim().min(1),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;

export const changeAccountPlanSchema = z
  .object({
    planId: z.uuid(),
  })
  .strict();

export type ChangeAccountPlanInput = z.infer<
  typeof changeAccountPlanSchema
>;
