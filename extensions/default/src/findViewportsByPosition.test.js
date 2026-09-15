import { findOrCreateViewport } from './findViewportsByPosition';

const hangingProtocolService = missingUID => ({
  getState: () => ({ protocolId: 'default', stageIndex: 0 }),
  getMissingViewport: () =>
    missingUID ? { displaySetsInfo: [{ displaySetInstanceUID: missingUID }] } : undefined,
});

describe('findOrCreateViewport', () => {
  it('reuses a position that previously showed something', () => {
    const viewportsByPosition = {
      '1-0': { displaySetInstanceUIDs: ['ds2'] },
      initialInDisplay: [],
    };
    const result = findOrCreateViewport(
      hangingProtocolService('ds3'),
      false,
      viewportsByPosition,
      1,
      '1-0',
      {}
    );
    expect(result.displaySetInstanceUIDs).toEqual(['ds2']);
  });

  it('fills a position that was previously empty with a newly available display set', () => {
    const viewportsByPosition = {
      '0-1': { displaySetInstanceUIDs: [] },
      initialInDisplay: ['ds1'],
    };
    const options = {};
    const result = findOrCreateViewport(
      hangingProtocolService('ds3'),
      false,
      viewportsByPosition,
      2,
      '0-1',
      options
    );
    expect(result.displaySetInstanceUIDs).toEqual(['ds3']);
    expect(options.inDisplay).toEqual(['ds1', 'ds3']);
  });
});
