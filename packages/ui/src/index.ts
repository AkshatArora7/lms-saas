/** Shared UI primitives for the LMS web and admin apps. */
export const theme = {
  colors: {
    primary: "#2563eb",
    danger: "#b91c1c",
    surface: "#ffffff",
    text: "#0f172a",
  },
  radius: "0.5rem",
} as const;

export type Theme = typeof theme;
