import { MIN_PASSWORD_LENGTH } from "../domain/auth/schema";
import { Form, type FormFieldProps } from "./kit/Form";
import { InputPassword } from "./kit/Input";

export function PasswordField({
  label,
  description,
  disabled,
  name = "password",
  autoComplete = "new-password",
  autoFocus,
  validate,
}: {
  label: string;
  description?: string;
  disabled: boolean;
  name?: string;
  autoComplete?: "current-password" | "new-password";
  autoFocus?: boolean;
  validate?: FormFieldProps["validate"];
}) {
  return (
    <Form.Field
      label={label}
      desc={description}
      name={name}
      validate={validate}
      required
    >
      <InputPassword
        name={name}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        disabled={disabled}
        minLength={MIN_PASSWORD_LENGTH}
      />
    </Form.Field>
  );
}
