# Features by audience — what the LMS provides

This guide explains **what our platform gives each kind of user**, in plain
language. It's organized by who you are:

- [For schools & institutions](#for-schools--institutions)
- [For administrators](#for-administrators)
- [For teachers](#for-teachers)
- [For students](#for-students)
- [For parents & guardians](#for-parents--guardians)

> This is the **product/feature** view. For the technical design see
> [`ARCHITECTURE.md`](ARCHITECTURE.md), [`MULTI_TENANCY.md`](MULTI_TENANCY.md) and
> the per-service specs in [`services/`](services).

A quick note on the words we use:

- **Tenant** — a customer space. A **district or university** is a *parent*
  tenant; each **school or college** under it is a *sub-tenant* with its own
  admins, branding, sign-on and rosters.
- **Org unit** — a level in the structure: district → school → department → term
  → course → section.
- **Role** — what someone is allowed to do, granted at a specific org level.

---

## For schools & institutions

*The school as a whole — what your institution gets by adopting the platform.*

### It becomes part of *your* world, not a separate website

- **Embed it in your existing portal/VLE.** Teachers and students launch the LMS
  straight from your current website using the **LTI 1.3** education standard — no
  separate destination to learn.
- **Use your own sign-in.** We connect to your identity provider (**SAML / OIDC
  single sign-on**), so people log in with the credentials they already have.
- **Make it look like yours (white-label).** Each school sets its **logo,
  favicon, colours, light/dark theme, a custom web address** (e.g.
  `lms.yourschool.edu`), custom styling and a support email. A district can set a
  **default look that schools inherit and override** field-by-field.
- **Keep your rosters in sync automatically.** We sync users, classes and
  enrollments with your **Student Information System** using the **OneRoster 1.2**
  standard — both pulling from and pushing back to your SIS — so you don't
  double-enter data.

### Districts and multi-school setups, handled

- **Onboard a district once, run every school independently.** Each school is its
  own space (its own admins, branding, rosters), while the **district sees
  consolidated reporting and billing** across all schools.
- **Each school's data stays private to that school.** Strong isolation means one
  school can never see another school's data — even within the same district.
- **Choose your isolation level.** Start on **shared infrastructure** (lowest
  cost, great for most K-12) and **upgrade to a dedicated database** later
  (for enterprise isolation, your own encryption keys, or data-residency
  requirements) with no disruption.

### Compliance and data ownership you can defend

- **Standards-based throughout** — LTI 1.3/Advantage, OneRoster 1.2,
  Caliper/xAPI, SCORM, QTI — so the platform fits your existing tools and
  procurement requirements.
- **Privacy and regulation ready** — designed around **FERPA, GDPR and COPPA**,
  including age-appropriate handling for K-12.
- **You own your data.** Export everything (OneRoster CSV + content archive) at
  any time, and we honor **deletion / right-to-erasure** on contract end.
- **Provable security** — a tamper-evident, hash-chained **audit log** and
  enforced per-school isolation that is tested continuously.

### Accessible and multilingual by default

- **WCAG 2.2 AA** accessibility across core flows, and **internationalization /
  localization** so the platform serves your whole community.

---

## For administrators

*District admins, school admins, and platform super-admins — the people who set
everything up and keep it running. Each admin only ever manages their own scope.*

### Set up your organization

- **Build your structure** — model district → school → department → term →
  course → section, and manage **academic terms/sessions**.
- **Onboard schools as sub-tenants** under a district, each administered
  independently.
- **Delegate safely.** A district admin can grant a **school admin** rights
  limited to **their school only** — they can't see sibling schools.

### Timetables and bell schedules

- **Define your bell schedule** — the named periods (e.g. "Period 1",
  "Homeroom") and their times, including A/B-day or weekday patterns.
- **Build the class timetable** — assign each section to a **period, room and
  teacher** within an academic term, with **conflict detection** so the same
  room or teacher is never double-booked.
- **Feeds everywhere it's needed** — timetables flow into everyone's calendar
  and iCal feed, and seed the rosters teachers use to take attendance.

### Control who can do what — with *your own* rules

- **Define your own roles** (e.g. "Teacher", "Department Head", "Exam Officer")
  and choose exactly **which capabilities** each role includes.
- **Grant roles at the right level** — at a whole school, a department, or a
  single section — with **cascade** down the hierarchy, so access is precise.
- **Set your own policies** beyond roles — password rules, quiz lockdown
  defaults, grading-scheme defaults, whether students can self-register, and more.
  Every tenant's rules are **its own and isolated** from others.

### Branding, rosters and integrations

- **Apply your branding** (logo, colours, theme, custom domain) for your school.
- **Connect your SIS** for automatic roster sync, and **register external tools**
  via LTI (and let approved tools register themselves via Dynamic Registration).
- **Manage SSO** so staff and students use your existing login.

### Oversight, reporting and billing

- **District roll-up reporting** — see engagement and outcomes **across all your
  schools** in one place (while each school's row-level data stays isolated).
- **Compliance & accreditation exports** — scheduled or on-demand (CSV / PDF /
  OneRoster).
- **Attendance policy & oversight** — define your school's **attendance codes**
  (and how each maps to present/absent/tardy/excused), and monitor attendance
  rates and **chronic-absence flags** across sections.
- **Plans, seats and usage** — manage subscriptions, see seat usage, and get
  **district-consolidated invoicing**.
- **Audit & data requests** — review the audit trail and fulfil data
  access/erasure (DSAR) requests.

---

## For teachers

*Everything to run a course: build it, teach it, assess it, and understand how
students are doing.*

### Build and organize your course

- **Reuse curriculum.** Start from a **course template**, then create a per-term
  offering — and **copy an entire course** into a new term in one step.
- **Structure content into modules and topics**, and set **release conditions**
  so material unlocks in order or when prerequisites are met.
- **Add any content** — text, files, embeds, interactive (H5P-style), **video**,
  and **SCORM/xAPI** packages — with automatic **completion tracking**.

### Assignments and assessments

- **Create assignments** with due dates and **late/penalty policies**, collect
  **file submissions**, and leave feedback (with optional **plagiarism** checks).
- **Build quizzes and exams** from **question banks** (import/export **QTI**),
  with **timed attempts** and **auto-grading** of objective questions.

### Grading, rubrics and outcomes

- **Use a full gradebook** with **weighted categories** and grade schemes;
  **calculate and release final grades**, and give students a clear view.
- **Grade with rubrics** (criteria × levels) attached to activities.
- **Track standards and competencies** — align activities to learning objectives
  and see **mastery** per student.

### Communicate and engage

- **Post announcements** (schedule them ahead) and reach students on their
  **preferred channel** (email / SMS / push / in-app).
- **Run discussions** — threaded forums with moderation, and **grade
  participation** where it counts.
- **Set up smart nudges** (intelligent agents) — e.g. automatically reach out when
  a student looks at-risk.

### Understand your class

- **Engagement & at-risk dashboards** show who's active, who's falling behind, and
  where to intervene.
- A **unified calendar** keeps all your course's deadlines in one place (with an
  iCal feed), alongside your **weekly teaching timetable** (periods, rooms).
- An **AI teaching helper** can **generate quiz questions** from your course
  material.

### Take attendance

- **Take attendance in seconds** — open the class meeting and the **roster is
  ready** from the section's enrolment and timetable.
- **Mark each student** present, absent, tardy or excused using your school's own
  **attendance codes**, add a note, then **finalize** to lock the session.
- **Spot patterns early** — per-student and per-section rates with
  **chronic-absence flags**; marks flow into reports and notify families.

---

## For students

*One clear place to learn, stay on track, and get help.*

### Everything for your courses in one place

- **See all your courses, content and progress** at a glance.
- **Work through lessons and modules**, including interactive content and
  **video that streams smoothly** on any device with **captions** for
  accessibility.
- Content **unlocks as you progress** when your teacher uses release conditions.

### Do your work and get feedback

- **Submit assignments** (upload files), see **due dates and late policies**, and
  receive **feedback and grades**.
- **Take quizzes and exams** — including **timed attempts** — and get immediate
  results on auto-graded questions.
- **See your grades clearly**, including how categories are weighted and your
  standing in the course.

### Stay on top of everything

- A **personal calendar** gathers every deadline across your courses, and you can
  **subscribe via iCal** in your own calendar app.
- Your **class timetable** shows where you need to be — periods, rooms and times —
  for every day of the week.
- **See your own attendance** record across courses, so there are no surprises.
- **Notifications** keep you informed on the channel you prefer, with **unread
  counts** and quiet hours you control.
- **Search** across your content, courses and discussions — fast and scoped only
  to you.

### Get help and connect

- **Join discussions** with classmates and teachers.
- Use an **AI study assistant** that answers questions **grounded in your own
  course content** (with citations) — so help is relevant and trustworthy.
- Learn on the go with the **mobile app** (dashboard, courses, deadlines,
  notifications, grades).
- The whole experience is **accessible (WCAG 2.2 AA)** and **available in your
  language**.

---

## For parents & guardians

*Stay informed and involved in your child's learning, with access scoped to your
own child only.*

> Parent/guardian is a first-class role in the platform; what a parent can see is
> controlled by the school's policies and role settings.

### See how your child is doing

- **Follow progress and grades** for your child's courses (where the school
  enables it), with the same clear gradebook view.
- **See upcoming deadlines** for assignments and quizzes through the shared
  calendar, so you can help your child plan.
- **Follow your child's attendance** — absences and tardies, with notifications
  when they happen so issues can be resolved quickly.
- **View course announcements** that keep you in the loop on what's happening.

### Stay informed, your way

- **Receive notifications** on your preferred channel (email / SMS / push /
  in-app) for the things that matter — new grades, announcements, or at-risk
  alerts — with preferences and quiet hours you control.
- **Calendar feed (iCal)** so your child's deadlines appear in your own calendar.

### Trusted and private

- Your access is **limited to your own child** and governed by the school's
  privacy policies.
- The platform is built around **FERPA / GDPR / COPPA**, with age-appropriate
  handling for younger students.
- Available in **multiple languages** and **accessible** for all families.

---

## Where this maps in the product

Every capability above is delivered by one of the platform's 26 services and is
tracked as a user story on the **LMS Delivery** GitHub board. For the engineering
view see [`services/`](services), [`ARCHITECTURE.md`](ARCHITECTURE.md), and the
[backlog](backlog/). The complete, mixed-audience feature catalogue also lives in
the root [`README.md`](../README.md).
