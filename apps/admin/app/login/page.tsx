import { getBranding } from "../lib/branding";
import LoginForm from "./login-form";

/** Server component: resolves tenant branding, then renders the sign-in form. */
export default function LoginPage() {
  return <LoginForm brand={getBranding()} />;
}
