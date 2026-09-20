/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './app.js';

describe('web app', () => {
  it('shows the login entry point before authentication', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Vibe Plan' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '注册' })).toBeTruthy();
  });
});
