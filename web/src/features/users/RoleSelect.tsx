import { USER_ROLES, type UserRole } from "../../domain/auth/schema";
import {
  Select,
  type SelectSize,
  type SelectVariant,
} from "../../ui/kit/Select";
import { userRoleLabel } from "./labels";

export function RoleSelect({
  "aria-label": ariaLabel,
  value,
  onChange,
  disabled,
  size,
  variant,
}: {
  "aria-label"?: string;
  value: UserRole;
  onChange: (role: UserRole) => void;
  disabled: boolean;
  size?: SelectSize;
  variant?: SelectVariant;
}) {
  return (
    <Select<UserRole>
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      size={size}
      variant={variant}
      popupWidth="content"
      options={USER_ROLES.map((role) => ({
        value: role,
        label: userRoleLabel(role),
      }))}
      onChange={onChange}
    />
  );
}
