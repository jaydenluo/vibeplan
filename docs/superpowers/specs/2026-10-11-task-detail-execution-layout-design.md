# Task Detail Execution Layout

## Goal

Make the task detail view optimized for daily execution: the user sees task state and the next available action immediately, while long execution and acceptance content remains independently scrollable.

## Design

- Keep the task detail panel header fixed while the detail body scrolls internally.
- Present the selected task title and key metadata in a compact summary at the top: priority, status, progress, assignee, and due date.
- Keep a single `编辑任务` action in the summary area; detailed editing remains in the existing edit form.
- Keep description and acceptance criteria in the first content section, using the existing two-column layout where space permits.
- Keep plan, dependencies, work logs, execution evidence, schedule comparison, and history below the first section in that order.
- Do not change the API or task data model.

## Acceptance Criteria

1. The detail heading remains visible while the detail body scrolls.
2. The first viewport shows the task identity and key metadata without requiring a scroll.
3. Only the existing task edit action is added to the summary area; no duplicate workflow actions are introduced.
4. Narrow screens collapse the first section to one column without horizontal overflow.
5. Existing task detail, acceptance, and project navigation tests continue to pass.
