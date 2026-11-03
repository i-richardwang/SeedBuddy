import { m } from "../../paraglide/messages";
import type { UserRole } from "../../domain/auth/schema";

export const USER_ROLE_LABELS: Record<UserRole, () => string> = {
  admin: m.role_admin,
  member: m.role_member,
};
