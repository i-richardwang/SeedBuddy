import type { UserRole } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";

const USER_ROLE_LABELS: Record<UserRole, () => string> = {
  admin: m.role_admin,
  member: m.role_member,
};

export function userRoleLabel(value: UserRole): string {
  return USER_ROLE_LABELS[value]();
}
