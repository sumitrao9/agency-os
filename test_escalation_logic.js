let PASS=0,FAIL=0;
function check(l,c,d=''){ if(c){PASS++;console.log('  PASS  '+l);} else {FAIL++;console.log('  FAIL  '+l+(d?' -> '+d:''));} }

// Simulate the exact loop structure from runAutoScan, with a fake "site" that
// NEVER yields more results, to verify it terminates correctly and hits
// the expected number of escalations before giving up.
function simulate(fullArea, addedPerCycle) {
  const MAX_CYCLES = 200;
  const STOP_AFTER_EMPTY_CYCLES = fullArea ? 3 : 4;
  const MAX_ZOOM_OUT_ATTEMPTS = 5;
  let cycle = 0, emptyStreak = 0, zoomOutAttempts = 0, escalations = 0;

  while (cycle < MAX_CYCLES && emptyStreak < STOP_AFTER_EMPTY_CYCLES && zoomOutAttempts < MAX_ZOOM_OUT_ATTEMPTS) {
    cycle++;
    const addedThisCycle = addedPerCycle(cycle);

    if (addedThisCycle === 0) {
      emptyStreak++;
      if (fullArea && emptyStreak >= STOP_AFTER_EMPTY_CYCLES) {
        zoomOutAttempts++;
        escalations++;
        emptyStreak = 0;
      }
    } else {
      emptyStreak = 0;
    }
  }
  return { cycle, zoomOutAttempts, escalations, terminated: cycle < MAX_CYCLES };
}

console.log('=== ESCALATION LOOP TERMINATION ===');
{
  // Full-area mode, a site with genuinely nothing ever — must terminate via zoomOutAttempts cap, not run forever
  const result = simulate(true, () => 0);
  check('Terminates (does not hit the 200-cycle safety ceiling)', result.terminated, JSON.stringify(result));
  check('Exactly 5 escalation attempts made (the real cap)', result.escalations === 5, result.escalations);
  check('Total cycles matches 5 escalations x 3 cycles-to-trigger-each', result.cycle === 15, result.cycle);
}
{
  // Non-full-area mode: no escalation at all, should stop after just 4 empty cycles
  const result = simulate(false, () => 0);
  check('Non-full-area mode stops quickly without escalating', result.cycle === 4 && result.escalations === 0, JSON.stringify(result));
}
{
  // Full-area mode, but results start flowing again after the first escalation
  let calls = 0;
  const result = simulate(true, (cycle) => {
    calls++;
    return cycle > 3 ? 1 : 0; // dry for first 3 cycles, then finds results after escalating once
  });
  check('Recovers and keeps going once results resume after an escalation', result.escalations === 1, JSON.stringify(result));
}

console.log('');
console.log(`TOTAL: ${PASS} passed, ${FAIL} failed`);
