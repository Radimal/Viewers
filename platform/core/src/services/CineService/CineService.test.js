import CineService from './CineService';

// startedClips held every element a clip ever played on until mode exit, so each clip switch
// in a long ultrasound session leaked the detached viewport.
describe('CineService.startedClips', () => {
  const makeService = () => {
    const service = new CineService();
    const stopClip = jest.fn();
    service.setServiceImplementation({
      playClip: jest.fn(),
      stopClip,
      setIsCineEnabled: jest.fn(),
    });
    return { service, stopClip };
  };

  it('forgets an element once its clip stops', () => {
    const { service } = makeService();
    const element = {};
    service.playClip(element, {});
    service.stopClip(element, {});
    expect(service.startedClips.size).toBe(0);
  });

  it('still stops every running clip on mode exit', () => {
    const { service, stopClip } = makeService();
    service.playClip({ id: 1 }, {});
    service.playClip({ id: 2 }, {});
    service.onModeExit();
    expect(stopClip).toHaveBeenCalledTimes(2);
    expect(service.startedClips.size).toBe(0);
  });
});
