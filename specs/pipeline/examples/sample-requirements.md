# Sample application requirements (pipeline examples)

## R1 — Submit feedback

- Authenticated or anonymous users may submit feedback with name, email, rating (1–5), and message.
- Empty required fields yield validation errors; invalid email is rejected.

## R2 — List feedback

- The feedback list shows stored entries and reflects new submissions after a successful create.

## E2E — Happy path

- User opens the feedback page, fills valid data, submits, and sees confirmation or list update.
