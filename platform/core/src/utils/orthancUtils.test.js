import { afterEach, expect, it, jest } from '@jest/globals';
import { downloadOrthancStudy, reporterOriginFor } from './orthancUtils';
import { ReporterAuthenticationError } from './reporterAuth';

afterEach(() => {
  jest.restoreAllMocks();
});

it('routes green staging viewer names and its public alias to staging Reporter', () => {
  expect(reporterOriginFor('https://green-main-view.stage-1.radimal.ai')).toBe(
    'https://reporter-staging.onrender.com'
  );
  expect(reporterOriginFor('https://green-main-2-view.stage-1.radimal.ai')).toBe(
    'https://reporter-staging.onrender.com'
  );
  expect(reporterOriginFor('https://green-view-stage-2.radimal.ai')).toBe(
    'https://reporter-staging.onrender.com'
  );
});

it('keeps local and production Reporter destinations distinct', () => {
  expect(reporterOriginFor('http://localhost:3000')).toBe('http://localhost:5007');
  expect(reporterOriginFor('https://view.radimal.ai')).toBe(
    'https://radimal-reporter.onrender.com'
  );
});

it('does not call the download endpoint when a viewer has no credentials', async () => {
  const request = jest.fn();
  Object.defineProperty(window, 'fetch', { configurable: true, value: request });
  await expect(downloadOrthancStudy('synthetic-study')).rejects.toBeInstanceOf(
    ReporterAuthenticationError
  );
  expect(request).not.toHaveBeenCalled();
});
