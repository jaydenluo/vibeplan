import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

describe('task directory layout', () => {
  it('uses a fluid project card grid with up to four columns', () => {
    expect(styles).toContain('.project-card-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 20px; }');
    expect(styles).toContain('.project-card { display: grid; grid-template-rows: auto auto auto; gap: 14px; min-width: 0;');
    expect(styles).not.toContain('gap: 14px; width: min(480px, 100%);');
  });

  it('keeps the task title column compact so owner and date columns stay adjacent', () => {
    expect(styles).toContain('--task-row-height: 54px;');
    expect(styles).toContain('grid-template-columns: 24px 24px minmax(0, 1fr) 48px 72px 32px;');
    expect(styles).toContain('.task-tree-item { position: relative; display: grid;');
    expect(styles).toContain('gap: 3px; width: 100%; height: var(--task-row-height); padding: 4px 14px 4px 10px; border: 0; border-bottom: 2px solid #edf1f3;');
    expect(styles).toContain('width: fit-content; max-width: 100%; min-width: 0; border: 0;');
    expect(styles).toContain('.task-date-range:hover { color: #52636e; background: transparent; }');
    expect(styles).toContain('.task-directory-heading {');
    expect(styles).toContain('padding-left: 10px;');
    expect(styles).toContain('.task-priority { display: inline-grid; place-items: center; width: 24px; height: 38px; padding-inline: 1px;');
    expect(styles).toContain('.task-meta-progress { --task-progress-track: #eef2f4; position: relative; display: flex; align-items: center; justify-content: space-between; min-width: 0; flex: 1 1 auto; overflow: hidden;');
    expect(styles).toContain('background: linear-gradient(to right, var(--task-progress-fill) var(--task-progress), var(--task-progress-track) var(--task-progress));');
    expect(styles).toContain('.task-meta-progress.progress-low { --task-progress-fill: #f9e6e4; }');
    expect(styles).toContain('.task-meta-progress.progress-mid { --task-progress-fill: #fbefd9; }');
    expect(styles).toContain('.task-meta-progress.progress-high { --task-progress-fill: #e6f2f5; }');
    expect(styles).toContain('.task-meta-progress.progress-complete { --task-progress-fill: #e8f3e4; }');
    expect(styles).toContain('--task-progress-track: #eef2f4;');
    expect(styles).toContain('.task-meta-progress > span { position: relative; z-index: 1; min-width: 0; overflow: hidden; color: var(--task-type-color);');
    expect(styles).toContain('.task-meta-progress b { position: relative; z-index: 1; flex: 0 0 auto; padding-left: 6px; color: #52636e;');
    expect(styles).toContain('.task-meta-progress.type-feature { --task-type-color: #245c70; }');
    expect(styles).toContain('.task-meta-progress.type-bug { --task-type-color: #8f3e38; }');
    expect(styles).toContain('.task-meta-progress b { position: relative; z-index: 1; flex: 0 0 auto; padding-left: 6px; color: #52636e; font-variant-numeric: tabular-nums; }');
    expect(styles).toContain('.task-tree-copy { display: grid; flex: 1 1 0; width: 100%; gap: 2px; min-width: 0; }');
    expect(styles).toContain('.task-tree-select { display: flex; align-items: center; gap: 3px; min-width: 0; width: 100%; margin-right: 9px;');
    expect(styles).toContain('.task-tree-toggle { display: grid; place-items: center; width: 24px; height: 24px;');
    expect(styles).toContain('.task-tree-toggle::after { width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; content: \'\'; transform: rotate(45deg) translate(-1px, -1px); }');
    expect(styles).toContain('.task-tree-toggle.is-collapsed::after { transform: rotate(-45deg) translate(-1px, -1px); }');
    expect(styles).toContain('.task-tree-item:has(.task-tree-toggle) .task-date-range { cursor: default; pointer-events: none; }');
  });

  it('places gantt zoom controls in the shared task header toolbar', () => {
    expect(styles).not.toContain('.gantt-toolbar');
    expect(styles).toContain('.gantt-scroll { position: relative;');
    expect(styles).toContain('.gantt-zoom-controls { display: flex; gap: 3px;');
    expect(styles).not.toContain('.gantt-zoom-controls { position: absolute;');
    expect(styles).toContain('.task-workspace-gantt .task-directory-heading { height: var(--task-header-height);');
  });

  it('keeps gantt range extension controls floating in the lower corners', () => {
    expect(styles).toContain('.gantt-card { position: relative; overflow: visible; background: #fff; }');
    expect(styles).toContain('.gantt-range-control { position: absolute; z-index: 6; bottom: 16px;');
    expect(styles).toContain('.gantt-range-control { position: absolute; z-index: 6; bottom: 16px; display: grid; place-items: center; width: 32px; height: 32px; border: 0;');
    expect(styles).toContain('padding: 0; color: #476979; background: transparent; }');
    expect(styles).not.toContain('.gantt-range-control { position: absolute; z-index: 6; bottom: 16px; display: grid; place-items: center; width: 32px; height: 32px; border: 1px solid');
    expect(styles).toContain('.gantt-range-control-before { left: 10px; }.gantt-range-control-after { right: 10px; }');
  });

  it('keeps task and gantt headers visible while their rows scroll', () => {
    expect(styles).toContain('.task-directory-heading, .task-detail-panel-heading { position: sticky; top: 0; z-index: 5; background: #fff; }');
    expect(styles).toContain('.gantt-calendar-sticky { position: sticky; top: 0; z-index: 5;');
  });

  it('keeps the gantt horizontal scrollbar and range controls in a fixed bottom rail', () => {
    expect(styles).toContain('.gantt-bottom-host { position: absolute; right: 0; bottom: 0; left: calc(var(--task-directory-width) + 8px);');
    expect(styles).toContain('.gantt-bottom-rail { display: grid; grid-template-columns: 40px minmax(0, 1fr) 40px;');
    expect(styles).toContain('.gantt-bottom-scroll { min-width: 0; height: 14px; overflow-x: auto;');
  });

  it('keeps the task search compact in the filter row', () => {
    expect(styles).toContain('.task-search { width: 220px; max-width: 220px; flex: 0 1 220px !important; min-width: 160px; }');
    expect(styles).toContain('.task-filter-select { position: relative; display: flex; flex: 0 0 auto; min-width: 0; }');
    expect(styles).toContain('.task-filter-select select { appearance: none; -webkit-appearance: none; min-width: 0; height: 30px; padding: 4px 28px 4px 8px; font-size: 11px; }');
    expect(styles).toContain('.task-filter-chevron { position: absolute; right: 7px;');
    expect(styles).toContain('.task-filter-clear { position: absolute; right: 7px;');
    expect(styles).toContain('transform: translateY(calc(-50% - 5px));');
    expect(styles).toContain('width: 16px; height: 16px;');
    expect(styles).toContain('font-size: 14px; line-height: 14px; transform: translateY(-50%);');
    expect(styles).not.toContain('.filter-clear {');
  });

  it('allows the gantt timeline to use its requested compact pixel scale', () => {
    expect(styles).toContain('.gantt-grid { width: max-content; min-width: calc(var(--gantt-days) * var(--gantt-day-width)); }');
    expect(styles).not.toContain('.gantt-grid { min-width: max(100%, calc(var(--gantt-days) * var(--gantt-day-width))); }');
  });

  it('places batch gantt controls in the task header instead of covering the timeline', () => {
    expect(styles).toContain('.gantt-batch-toolbar-host { display: flex; flex: 1 1 auto; min-width: 0; justify-content: flex-end; }');
    expect(styles).toContain('.gantt-batch-toolbar { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none;');
    expect(styles).toContain('.gantt-batch-toolbar.is-idle { color: #9aa6ad; }');
    expect(styles).not.toContain('.gantt-batch-toolbar { position: absolute;');
  });

  it('keeps gantt bars within their scheduled width and reveals information by available space', () => {
    expect(styles).toContain('gap: 4px; min-width: 0; height: 32px;');
    expect(styles).toContain('padding: 0 4px;');
    expect(styles).toContain('.gantt-bar-title { min-width: 0; flex: 1 1 auto;');
    expect(styles).toContain('.gantt-bar-progress, .gantt-bar-duration { flex: 0 0 auto; white-space: nowrap;');
    expect(styles).toContain('@container (max-width: 128px) { .gantt-bar-title { display: none; } }');
    expect(styles).toContain('@container (max-width: 64px) { .gantt-bar-progress { display: none; } .gantt-bar-duration small { display: none; } .gantt-bar { justify-content: center; gap: 0; padding: 0; } }');
  });

  it('uses pale status bars by default and a clearly stronger selected state', () => {
    expect(styles).toContain('.gantt-bar.status-in_progress { color: #2e627c; background: #e3f0f5; }');
    expect(styles).toContain('.gantt-bar.status-done { color: #4d7049; background: #e4f1e1; }');
    expect(styles).toContain('.gantt-bar.status-blocked { color: #98443f; background: #fbe5e2; }');
    expect(styles).toContain('.gantt-bar.status-ready { color: #496a8c; background: #e7eef8; }');
    expect(styles).toContain('.gantt-bar.status-in_review { color: #86611d; background: #fff4d7; }');
    expect(styles).toContain('.task-meta-status.status-ready { color: #496a8c; background: #e7eef8; }');
    expect(styles).toContain('.task-meta-status.status-in_review { color: #86611d; background: #fff4d7; }');
    expect(styles).toContain('.gantt-bar.selected { color: #fff; box-shadow: 0 0 0 2px #963e3a, 0 3px 8px #24374624; }');
    expect(styles).toContain('.gantt-bar.selected > span:not(.gantt-resize-handle), .gantt-bar.selected small { color: #fff; }');
    expect(styles).toContain('.gantt-bar.status-in_progress.selected { background: #5a9fb2; }');
    expect(styles).not.toContain('.gantt-bar:hover, .gantt-bar:focus-visible { background: #245fd8;');
  });

  it('keeps task summary metadata compact and right-aligned', () => {
    expect(styles).toContain('grid-template-columns: minmax(0, 1fr) max-content auto;');
    expect(styles).toContain('grid-template-columns: repeat(4, max-content); justify-content: end;');
    expect(styles).toContain('.task-detail-summary-meta { display: flex; flex-wrap: wrap;');
  });

  it('keeps task directory and detail headings at the same fixed height', () => {
    expect(styles).toContain('height: var(--task-header-height); min-height: var(--task-header-height); flex: 0 0 var(--task-header-height);');
  });

  it('keeps task detail tabs in the fixed heading and allows narrow screens to scroll them', () => {
    expect(styles).toContain('.task-detail-tabs { display: flex; align-items: stretch;');
    expect(styles).toContain('overflow-x: auto; white-space: nowrap;');
    expect(styles).toContain('.task-detail-tabs button.active { color: #2f657d; border-bottom-color: #2f657d; }');
  });

  it('keeps the task overview focused on its detail sections', () => {
    expect(styles).toContain('.task-overview-metrics { display: none;');
    expect(styles).toContain('.task-detail-overview { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(260px, .65fr);');
    expect(styles).toContain('.task-overview-metric strong {');
    expect(styles).toContain('.task-overview-section {');
  });

  it('gives the task description the full detail width and stacks changed files', () => {
    expect(styles).toContain('.detail-description { grid-column: 1 / -1; }');
    expect(styles).toContain('.task-report-files { display: grid;');
  });

  it('keeps dependency and history panels readable with bounded internal scrolling', () => {
    expect(styles).toContain('.task-dependency-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); max-height: 220px; overflow: auto;');
    expect(styles).toContain('.task-dependency-view { grid-column: 1 / -1;');
    expect(styles).toContain('.task-dependency-remove {');
    expect(styles).toContain('.task-dependency-modal { width: min(520px, 100%); display: grid;');
    expect(styles).toContain('.task-dependency-options { display: grid; max-height: 150px; overflow: auto;');
    expect(styles).toContain('.task-history-filters { display: flex;');
    expect(styles).toContain('.task-history-event { display: grid;');
    expect(styles).toContain('.task-history > ol { display: grid; max-height: 420px; overflow: auto;');
  });
});
