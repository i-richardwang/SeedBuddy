import { timestampSchema } from "../identifiers/schema";
import { z } from "zod";

/**
 * Workbench accounts. Every signed-in person holds one role: administrators
 * maintain accounts, members use the workbench. Accounts are created by an
 * administrator; there is no self-service sign-up.
 */

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const userRoleSchema = z.enum(USER_ROLES);

export const MIN_PASSWORD_LENGTH = 12;

const userNameSchema = z.string().trim().min(1).max(120);
const userEmailSchema = z.string().trim().toLowerCase().email().max(254);
const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(256);

// Better Auth session.user includes provider-owned account fields.
export const workbenchUserSchema = z.object({
  id: z.string(),
  name: userNameSchema,
  email: userEmailSchema,
  role: userRoleSchema,
});
export type WorkbenchUser = z.infer<typeof workbenchUserSchema>;

export const userAccountSchema = z.strictObject({
  ...workbenchUserSchema.shape,
  banned: z.boolean(),
  createdAt: timestampSchema,
});
export type UserAccount = z.infer<typeof userAccountSchema>;

export const userRefSchema = z.strictObject({ user: z.string() });

export const userCreateSchema = z.strictObject({
  name: userNameSchema,
  email: userEmailSchema,
  password: passwordSchema,
  role: userRoleSchema,
});

export const userRoleUpdateSchema = userRefSchema.extend({
  role: userRoleSchema,
});

export const userPasswordUpdateSchema = userRefSchema.extend({
  password: passwordSchema,
});

export function isAdmin(user: Pick<WorkbenchUser, "role">): boolean {
  return user.role === "admin";
}
