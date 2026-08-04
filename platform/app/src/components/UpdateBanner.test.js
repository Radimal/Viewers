import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import UpdateBanner from './UpdateBanner';
import { UPDATE_AVAILABLE_EVENT } from '../utils/cacheManager';

const NEW_COMMIT = '9f8e7d6c5b4a3210fedcba9876543210deadbeef';
const BANNER_TEXT = 'New Update Today | Click to Refresh';

// Note: JSX is unavailable in *.test.js here (the TypeScript babel preset
// parses .js without JSX support), so we use React.createElement directly.
const renderBanner = () => render(React.createElement(UpdateBanner));

function dispatchUpdateAvailable(commit) {
  act(() => {
    window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT, { detail: { commit } }));
  });
}

describe('UpdateBanner', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('is hidden by default', () => {
    renderBanner();
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();
  });

  it('shows the exact banner copy when an update event fires', () => {
    renderBanner();
    dispatchUpdateAvailable(NEW_COMMIT);
    expect(screen.getByText(BANNER_TEXT)).toBeTruthy();
  });

  it('hides for the session when dismissed, but shows again for a different commit', () => {
    renderBanner();
    dispatchUpdateAvailable(NEW_COMMIT);

    fireEvent.click(screen.getByLabelText('Dismiss update notification'));
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();

    // Same commit again — stays dismissed.
    dispatchUpdateAvailable(NEW_COMMIT);
    expect(screen.queryByText(BANNER_TEXT)).toBeNull();

    // A newer (different) commit — reappears.
    dispatchUpdateAvailable('0123456789abcdef0123456789abcdef01234567');
    expect(screen.getByText(BANNER_TEXT)).toBeTruthy();
  });

  it('uses the static bg-primary-main blue, not the stylesheet-order-dependent bg-primary', () => {
    // --primary is declared at :root by both ui and ui-next tailwind.css with different values,
    // so `bg-primary` renders whichever stylesheet lands later in the bundle (currently grey).
    // A refactor back to it already shipped grey once; pin the static class instead.
    renderBanner();
    dispatchUpdateAvailable(NEW_COMMIT);

    const pill = screen.getByText(BANNER_TEXT).closest('.bg-primary-main');
    expect(pill).toBeTruthy();
    expect(pill.className).not.toMatch(/(^|\s)bg-primary(\s|$)/);
  });
});
