import { cleanup, render } from "@testing-library/react";
import { axe } from "jest-axe";
import { afterEach, describe, expect, it } from "vitest";

import { Alert, Badge, Button, Field, Input } from "./index.js";
import { AppShell, BrandMark } from "./components/shell.js";
import type { Brand } from "./theme.js";

// jest-axe ships matcher types for jest's expect; teach vitest's expect about it.
interface AxeMatchers<R = unknown> {
  toHaveNoViolations(): R;
}
declare module "vitest" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface Assertion<T = unknown> extends AxeMatchers<T> {}
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface AsymmetricMatchersContaining extends AxeMatchers {}
}

const brand: Brand = {
  name: "Northwind Academy",
  tagline: "Welcome back to Northwind Academy.",
  accent: "#0f7b6c",
};

afterEach(() => {
  cleanup();
});

describe("@lms/ui a11y regression (axe)", () => {
  it("AppShell renders with no axe violations", async () => {
    const { container } = render(
      <AppShell actions={<Button variant="ghost">Sign out</Button>} brand={brand}>
        <h1>Welcome back</h1>
        <p>Here is your learning at a glance.</p>
      </AppShell>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it("AppShell exposes a skip-link to #main as a real landmark target", () => {
    const { container } = render(
      <AppShell brand={brand}>
        <h1>Dashboard</h1>
      </AppShell>,
    );
    const skip = container.querySelector("a.lms-skip-link");
    expect(skip).not.toBeNull();
    expect(skip?.getAttribute("href")).toBe("#main");
    const main = container.querySelector("main#main");
    expect(main).not.toBeNull();
    // The skip-link must be the first focusable element in source order.
    const firstLink = container.querySelector("a, button");
    expect(firstLink).toBe(skip);
  });

  it("decorative BrandMark is hidden from AT with an empty alt (no duplicate name)", () => {
    const logoBrand: Brand = { ...brand, logoUrl: "data:image/svg+xml,<svg/>" };
    const { container } = render(<BrandMark brand={logoBrand} decorative />);
    const mark = container.querySelector(".lms-brandmark");
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
    expect(mark?.getAttribute("aria-label")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("alt")).toBe("");
  });

  it("non-decorative BrandMark keeps an accessible name", () => {
    const { container } = render(<BrandMark brand={brand} />);
    const mark = container.querySelector(".lms-brandmark");
    expect(mark?.getAttribute("aria-hidden")).toBeNull();
    expect(mark?.getAttribute("aria-label")).toBe(brand.name);
  });

  it("Field associates its label and error and marks the control invalid", async () => {
    const { container } = render(
      <form aria-label="Sign in">
        <Field error="Email or password is incorrect." htmlFor="email" label="Email" required>
          <Input autoComplete="email" name="email" type="email" />
        </Field>
      </form>,
    );
    const input = container.querySelector("#email");
    expect(input?.getAttribute("aria-invalid")).toBe("true");
    const describedBy = input?.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("email-error");
    const errorNode = container.querySelector("#email-error");
    expect(errorNode?.textContent).toContain("incorrect");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("status components render with no axe violations", async () => {
    const { container } = render(
      <main>
        <h1>Status</h1>
        <Alert tone="danger">Email or password is incorrect.</Alert>
        <Badge tone="success">Published</Badge>
        <Badge tone="warning">Overdue</Badge>
        <Button variant="primary">Save draft</Button>
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
