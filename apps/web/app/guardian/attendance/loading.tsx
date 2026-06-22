import { Card, Grid, Skeleton, Stack } from "@lms/ui";

/**
 * Route-level loading UI for the guardian attendance screen (App Router Suspense
 * fallback). Mirrors the real layout — a child-selector chip row over a KPI band
 * of four stat cards over a couple of history group cards — so the page does not
 * jump when the RSC data arrives. The region is announced with role="status" /
 * aria-busy and the @lms/ui Skeleton shimmer already honours
 * prefers-reduced-motion via .lms-skeleton.
 */
export default function GuardianAttendanceLoading() {
  return (
    <main
      aria-busy="true"
      role="status"
      style={{
        maxWidth: "var(--lms-container, 72rem)",
        margin: "0 auto",
        padding: "var(--lms-space-6) var(--lms-space-4)",
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      <span
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          overflow: "hidden",
          clip: "rect(0 0 0 0)",
        }}
      >
        Loading children's attendance…
      </span>
      <Stack gap={4}>
        <Skeleton width="9rem" height="2.25rem" radius="var(--lms-radius-md)" />
        <Skeleton width="16rem" height="2.5rem" />
        <Skeleton width="22rem" height="1.1rem" />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--lms-space-2)" }}>
          {[0, 1, 2].map((i) => (
            <Skeleton
              key={`chip-${i}`}
              width="9rem"
              height="2.75rem"
              radius="var(--lms-radius-pill)"
            />
          ))}
        </div>

        <Grid gap={4} min="200px">
          {[0, 1, 2, 3].map((i) => (
            <Card key={i}>
              <Stack gap={2}>
                <Skeleton width="4rem" height="2.4rem" />
                <Skeleton width="8rem" height="0.85rem" />
              </Stack>
            </Card>
          ))}
        </Grid>

        {[0, 1].map((i) => (
          <Card key={`group-${i}`}>
            <Stack gap={3}>
              <Skeleton width="12rem" height="1.2rem" />
              <Skeleton width="100%" height="1rem" />
              <Skeleton width="100%" height="1rem" />
            </Stack>
          </Card>
        ))}
      </Stack>
    </main>
  );
}
