import { z } from "zod";

export const createUserSchema = z
  .object({
    externalUserId: z.string().trim().min(1),
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserSchema>;
