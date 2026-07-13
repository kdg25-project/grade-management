# Confirmed domain rules

## Source precedence

Apply the latest user instruction first, then the Notion design document, then the Google Docs answers for sections marked 「要ヒアリング」. Do not copy full external documents or sensitive data into the repository.

## Academic year and terms

- Store the current academic year in PostgreSQL. Use April 1 as its initial automatic boundary, but treat the dedicated staff's administrative selection as authoritative.
- Determine a teacher's current grade-entry term per subject. Show the first term until dedicated staff finalize that subject's first-term grades; then show the second term.
- Finalize grades per subject and term, not globally. A finalized term is read-only for teachers. Any reopen/cancel-finalization operation must be explicitly authorized and audited.
- Preserve the year and term on grade records so later administrative changes cannot rewrite history.

## Grade calculation

Use these inputs:

- `attendance_rate`: attendance score on a 0–100 scale
- `attitude`: attitude rating on a 0–10 scale
- `assignment`: assignment rating on a 0–10 scale
- `aw`, `tw`, `sw`: percentage weights for attendance, attitude, and assignments; require `aw + tw + sw = 100`

Calculate the final score exactly as:

```text
final_score = attendance_rate * (aw / 100)
            + attitude * 10 * (tw / 100)
            + assignment * 10 * (sw / 100)
```

Validate all input ranges and weights. Do not silently clamp invalid values. Define the persisted scale and rounding with the product owner before a lossy conversion.

Assign the grade from the calculated score using inclusive lower bounds:

- `final_score >= 90`: S
- `final_score >= 80`: A
- `final_score >= 70`: B
- `final_score >= 60`: C
- otherwise: F

Test exact boundaries and values immediately below them.

## Roles and authorization

- Teachers can enter grades only for subjects they are assigned to and only for the currently editable term.
- Dedicated staff perform administrative operations, including subject-term finalization and academic-year management.
- Enforce authorization and ownership server-side. A hidden or disabled control is not an authorization boundary.
- Integrate authentication with Better Auth in the API and use its `auth-client` in the Web app when authentication is implemented. Do not invent unsettled session or account policy.

## Students and enrollment

- The course duration is uniformly three years. Transfers into the school are not supported.
- Display students on leave or withdrawn in gray where they remain visible.
- Hide withdrawn students from the following academic year onward; retain their historical records.

## CSV import and annual rollover

- Keep ordinary CSV import and the annual rollover wizard as separate workflows.
- Reject the entire import when any record has a consistency error. Never partially commit a logical import.
- Protect every import with one PostgreSQL transaction and a unique idempotency key. A Cloudflare D1 commit token is only an example of the idempotency pattern, not a required technology.
- The annual rollover wizard handles graduation, teachers, subjects by grade, and incoming students in an ordered, reviewable workflow. Repeated submission must not duplicate or reapply completed work.
- Validate file structure, references, duplicates, authorization, and target academic year before mutation. Return actionable row-level errors without exposing personal data unnecessarily.

## Other confirmed constraints

- Password-reset tokens expire after 30 minutes.
- PDF layout is not yet specified; do not freeze a layout without user confirmation.
- Performance targets are: ordinary screen response within 3 seconds, grade reflection within 10 seconds, PDF generation within 10 seconds, and CSV processing within 1 minute.
