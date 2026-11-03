import type { UserRole } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";

export const USER_ROLE_LABELS: Record<UserRole, () => string> = {
  admin: m.role_admin,
  member: m.role_member,
};
