# Northwind LMS — User Guide

A walkthrough of the learning platform **as it works today**, with live
screenshots captured from the running app. Every screen below was rendered from
the actual application against the local demo data — nothing here is a mockup or
a planned feature. Where a screen is intentionally a placeholder, this guide
says so plainly.

> Screenshots use the bundled demo tenant **“Northwind Academy.”** The brand
> name, colours, and logo are not hard-coded — they come from the tenant’s
> branding, so a different school sees its own identity on these same screens.

---

## 1. What this project is

This is a **multi-tenant, white-label Learning Management System (LMS)**. The
goal is to let many schools (“tenants”) run their own branded learning
experience on one shared platform, with each tenant’s data kept strictly
isolated from the others.

The product is split into two audiences, both served by the learner/teacher web
app (`apps/web`):

- **Learners** — see their courses, course content, grades, schedule,
  announcements, assignments, and discussions.
- **Teachers** — manage the courses they teach: assignments, announcements,
  discussions, the gradebook, and the class roster.

Behind the web app sits a set of small backend services (identity, assignment,
announcement, discussion, enrollment, attendance, and more). The web app never
exposes these services or raw auth tokens to the browser — it talks to them from
its own server and keeps tokens in secure `httpOnly` cookies.

---

## 2. Running it locally (how these screenshots were produced)

The app runs with **in-memory demo data** — no database required. Each service
is started with its `*_STORE=memory` flag, which seeds demo accounts and content.

```bash
# Identity (auth) — provides sign-in and session checks
cd services/identity   && IDENTITY_STORE=memory   PORT=4001 pnpm dev

# Backing services for the teacher screens (each in its own terminal)
cd services/assignment   && ASSIGNMENT_STORE=memory   pnpm dev   # :4007
cd services/announcement && ANNOUNCEMENT_STORE=memory pnpm dev   # :4011
cd services/discussion   && DISCUSSION_STORE=memory   pnpm dev   # :4010
cd services/enrollment   && ENROLLMENT_STORE=memory   pnpm dev   # :4004
cd services/attendance   && ATTENDANCE_STORE=memory   pnpm dev   # :4025

# The web app
cd apps/web && pnpm dev   # http://localhost:3000
```

**Demo sign-in (shown right on the login screen):**

| Account | Email | Password |
| --- | --- | --- |
| Admin / Teacher | `admin@demo.school` | `password123` |
| Student | `student@demo.school` | `password123` |

> The learner screens read from bundled demo course data and render regardless of
> which demo account you use. The teacher screens read live from the services
> above; if a service isn’t running, that screen shows an honest “service
> unreachable” notice instead of failing.

---

## 3. Signing in

A branded, split-screen sign-in. The left panel carries the tenant’s identity;
the right is the sign-in form, including a “Sign in with your school account”
(SSO) option.

![Sign in](images/01-login.png)

---

## 4. The learner experience

### Course detail

The course landing page: title, description, course code/term, the learner’s
role, and the full **course content** broken into modules. Each item shows its
type (Lesson / Assignment / Quiz) and status (Completed / In progress / Not
started). The sidebar summarises progress, instructor, term, and course code.

![Course detail](images/02-course-detail.png)

### Content item — lesson

Opening an item shows a focused reading layout: the item title, its type and
status, and a body card. The **“In this module”** rail on the right shows the
item’s position (“Item 2 of 3”) and lets the learner move between siblings, with
**Previous / Next** links at the bottom.

The body is currently an **honest placeholder** — “Full content coming soon. The
content service isn’t wired up yet…” — and the **Mark lesson complete** button is
deliberately disabled until that service is connected.

![Content item — lesson](images/03-content-item-lesson.png)

### Content item — quiz

The same layout adapts to the item type. For a quiz, the primary action reads
**Start quiz**; for an assignment it reads **Open assignment**. The rail also
reflects the boundary — the last item in a module shows “You’re at the end of
this module.”

![Content item — quiz](images/04-content-item-quiz.png)

### Course discussions

Threaded discussions for a course: counts for total threads and unanswered ones,
a pinned thread, reply counts, last-activity timestamps, and an **Unanswered**
flag.

![Course discussions](images/05-discussions.png)

### Announcements

A cross-course announcement feed with an unread count, filter chips
(All / Courses / School), per-item scope tags, source, and relative timestamps.

![Announcements](images/06-announcements.png)

### Assignments

Everything due across the learner’s courses, sorted by urgency. Summary tiles
(Overdue / Due soon / Submitted) sit above a list where each row shows status,
due date, course, type, and points.

![Assignments](images/07-assignments.png)

### Grades

Current grade per course with a letter grade and a category breakdown
(e.g. Homework / Quizzes / Exams) showing each category’s weight and score.

![Grades](images/08-grades.png)

### Schedule

The week’s classes with summary tiles (classes this week, teaching days, what’s
up next) and a day-by-day grid showing time, subject, room, and instructor. The
next upcoming class is highlighted.

![Schedule](images/09-schedule.png)

### Attendance

The learner’s attendance summary — Sessions recorded / Absences / Tardies /
Excused. For the demo account no sessions are recorded yet, so the page shows its
**empty state**.

![Attendance](images/10-attendance.png)

### Profile

The signed-in account’s details: name, email, role, tenant id and tier, and
granted scopes, plus learning preferences (language, time zone, email
notifications). Preferences are **read-only for now** — the page says so — until
the profile service is wired up.

![Profile](images/11-profile.png)

---

## 5. The teacher experience

### Teaching overview

The teacher’s home: totals (courses taught, learners enrolled, at-risk
learners) and a card per course with quick links (Discussions, Roster,
Announcements, Assignments, Gradebook), an average-engagement bar, and an
at-risk-learners list.

![Teaching overview](images/12-teach.png)

### Assignments — manage

The live assignment list for a course (served by the assignment service):
counts, then each assignment with due date, points, submission type, a late-
submission badge, and **Edit / Delete** actions. The description notes that
“changes are saved straight to the assignment service for this tenant.”

![Teach — assignments](images/13-teach-assignments.png)

### New assignment form

The authoring form: details (title, instructions), schedule & grading (due date,
points), submission type, and an “allow late submissions” toggle, with
**Create assignment / Cancel** actions.

![Teach — new assignment](images/14-teach-assignment-new.png)

### Announcements — manage

The course’s announcements, served by the announcement service, with authoring
controls.

![Teach — announcements](images/15-teach-announcements.png)

### Discussions — manage

The course’s forums (served by the discussion service) with a **New forum**
action and **Open topics** to drill in.

![Teach — discussions](images/16-teach-discussions.png)

### Gradebook

A full grade matrix: every enrolled learner’s score on each assignment, per-
assignment and per-learner totals, a class average row, and a **Needs
attention** strip flagging missing work and low scores.

![Teach — gradebook](images/17-teach-gradebook.png)

### Roster — manage

The class roster (served by the enrollment service): active members, learner vs
staff counts, each member’s role and enrollment date, and actions to **Change
role / Complete / Drop**, plus **Enroll learner**.

![Teach — roster](images/18-teach-roster.png)

---

## 6. Responsive design

Every screen is built for phone, tablet, and desktop. On a phone the content-item
view stacks: the body card first, then Previous/Next, then the “In this module”
rail — no horizontal overflow.

| Content item (mobile) | Course detail (mobile) | Teaching (mobile) |
| --- | --- | --- |
| ![Content item mobile](images/m-03-content-item-lesson.png) | ![Course detail mobile](images/m-02-course-detail.png) | ![Teaching mobile](images/m-12-teach.png) |

---

## 7. What is intentionally not finished yet

To keep this guide honest, these are the places the app deliberately shows a
placeholder rather than a finished feature:

- **Lesson / quiz bodies** — the content service isn’t wired in, so item bodies
  show a “content coming soon” note and the complete/start actions are disabled.
- **Profile preferences** — displayed but read-only until the profile service is
  connected.
- **Attendance history** — the view works but shows an empty state for the demo
  account (no sessions seeded).
- **Service-backed teacher screens** — when a backing service isn’t running, the
  screen shows a clear “service unreachable / service offline” message with
  instructions to start it, instead of breaking.
