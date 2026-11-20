// F13 / FE2-7 isolation probe, file B (partner: isolationA.probe.ts; see isolationProbe.ts).
// Not part of the main run: build.test.ts runs this pair alone, in one worker (isolation.config.ts).
import { CLEAN, leaveEverythingBehind, leftovers, planted } from './isolationProbe';

test('F13 FA-5 isolation probe B: nothing another test file left behind is visible here', () => {
  expect(leftovers()).toEqual(CLEAN);
  leaveEverythingBehind('isolationB');
  expect(leftovers()).toEqual(planted('isolationB'));
});
