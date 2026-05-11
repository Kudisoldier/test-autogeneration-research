# Sample application requirements (pipeline examples)

## R1 — Submit feedback

- Authenticated or anonymous users may submit feedback with name, email, rating (1–5), and message.
- Empty required fields yield validation errors; invalid email is rejected.

## R2 — List feedback

- The feedback list shows stored entries and reflects new submissions after a successful create.

## E2E — Happy path

- User opens the feedback page, fills valid data, submits, and sees confirmation or list update.

## E2E — Validation and loading UI

- Inline field errors render beside controls (`error-name`, `error-email`, etc.) with `role="alert"`; they are not the input’s value text.
- Invalid email (blur or submit) shows **Please enter a valid email address** in the email error region.
- During submit, the submit button is disabled and its label text is **Submitting...**; idle label is **Submit Feedback**.
