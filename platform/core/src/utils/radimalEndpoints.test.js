import {
  getRadimalEnvironment,
  getReporterOrigin,
  getVetAppOrigin,
  VET_APP_ALLOWED_ORIGINS,
} from './radimalEndpoints';

describe('radimalEndpoints', () => {
  describe('getRadimalEnvironment', () => {
    it('maps localhost:3000 to local', () => {
      expect(getRadimalEnvironment('http://localhost:3000')).toBe('local');
    });

    it('maps both staging viewer hostnames to staging', () => {
      expect(getRadimalEnvironment('https://viewer.stage-1.radimal.ai')).toBe('staging');
      expect(getRadimalEnvironment('https://view.stage-1.radimal.ai')).toBe('staging');
    });

    it('maps the prod viewer to prod', () => {
      expect(getRadimalEnvironment('https://view.radimal.ai')).toBe('prod');
    });

    it('falls through to prod for unknown origins', () => {
      expect(getRadimalEnvironment('https://something-else.example.com')).toBe('prod');
    });

    it('does not treat lookalike domains as staging', () => {
      expect(getRadimalEnvironment('https://evil-stage-1.radimal.ai.attacker.com')).toBe('prod');
    });
  });

  describe('endpoint resolution', () => {
    it('returns https reporter origins outside local (regression: https://http:// typo)', () => {
      expect(getReporterOrigin('https://view.radimal.ai')).toBe(
        'https://radimal-reporter.onrender.com'
      );
      expect(getReporterOrigin('https://view.stage-1.radimal.ai')).toBe(
        'https://reporter-staging.onrender.com'
      );
      expect(getReporterOrigin('http://localhost:3000')).toBe('http://localhost:5007');
    });

    it('resolves the vet app origin per environment', () => {
      expect(getVetAppOrigin('http://localhost:3000')).toBe('http://localhost:8000');
      expect(getVetAppOrigin('https://viewer.stage-1.radimal.ai')).toBe(
        'https://radimal-vet-staging.onrender.com'
      );
      expect(getVetAppOrigin('https://view.radimal.ai')).toBe('https://vet.radimal.ai');
    });

    it('exposes exactly the three vet origins for postMessage validation', () => {
      expect(VET_APP_ALLOWED_ORIGINS).toEqual([
        'http://localhost:8000',
        'https://radimal-vet-staging.onrender.com',
        'https://vet.radimal.ai',
      ]);
    });
  });
});
