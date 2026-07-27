// src/main/decisionEngine.js
// Step 9: total score -> action. Plain lookup, no judgment calls at runtime.

const THRESHOLDS = [
  { min: 95, action: 'Call today' },
  { min: 90, action: 'Email today' },
  { min: 80, action: 'Priority' },
  { min: 70, action: 'Good lead' },
  { min: 60, action: 'Follow later' },
  { min: 0, action: 'Archive' },
];

function decideAction(total) {
  const match = THRESHOLDS.find((t) => total >= t.min);
  return match ? match.action : 'Archive';
}

module.exports = { decideAction, THRESHOLDS };
