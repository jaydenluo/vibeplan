# Project Directory Collapse Design

## Goal

Make the project-management page dedicate its header to navigation and the active project, while letting users collapse the project directory without losing rapid project switching.

## Confirmed Behavior

- Remove the V logo, application version, and `VibePlan` identity from the project-management header only.
- Keep the return action and active project name in the header.
- Add a bottom-aligned directory toggle on desktop.
- Default to the existing expanded directory. Persist the chosen state in browser local storage.
- In collapsed state, keep a narrow icon-only project rail. The selected project remains visibly highlighted, every icon has the project name as an accessible label and tooltip, and the bottom control expands the directory.
- Preserve the current mobile horizontal project list; collapse is a desktop-only workspace control.

## Boundaries

- No API, task data, routing, or project-selection behavior changes.
- The task directory and Gantt/detail layout remain unchanged.
- The page-specific header must not alter branding on overview, team, or project-list pages.

## Verification

- Component test verifies the brand markup is absent and the collapse control switches to the icon rail.
- Component test verifies the collapsed state restores from local storage and project selection remains possible.
- Run the affected Vitest suite and the web build.
