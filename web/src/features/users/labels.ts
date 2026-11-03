import type { UserAccount, UserRole } from "../../domain/auth/schema";
import { m } from "../../paraglide/messages";
import type { StatusTone } from "../../ui/kit/Status";

const USER_ROLE_LABELS = {
  admin: m.role_admin,
  member: m.role_member,
} as const satisfies Record<UserRole, () => string>;

export function userRoleLabel(value: UserRole): string {
  return USER_ROLE_LABELS[value]();
}

const USER_STATUS = {
  suspended: { label: m.user_status_suspended, tone: "warning" },
  active: { label: m.active_label, tone: "success" },
} as const satisfies Record<"active" | "suspended", { label: () => string; tone: StatusTone }>;
export function userStatusLabel(account: UserAccount) {
  return USER_STATUS[account.banned ? "suspended" : "active"].label();
}
export function userStatusTone(account: UserAccount) {
  return USER_STATUS[account.banned ? "suspended" : "active"].tone;
}
