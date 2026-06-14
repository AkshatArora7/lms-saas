import { ThemeStyle, UIStyles } from "@lms/ui";

import { getBranding } from "../lib/branding";
import LoginForm from "./login-form";

/** Server component: resolves tenant branding, then renders the sign-in form. */
export default function LoginPage() {
  const brand = getBranding();

  return (
    <>
      <UIStyles />
      <ThemeStyle brand={brand} />
      <div className="lms-theme">
        <LoginForm brand={brand} />
      </div>
    </>
  );
}
