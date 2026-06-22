import { expect } from "vitest";
import { toHaveNoViolations } from "jest-axe";

// Register the jest-axe matcher so component tests can assert
// `expect(await axe(container)).toHaveNoViolations()`.
expect.extend(toHaveNoViolations);
