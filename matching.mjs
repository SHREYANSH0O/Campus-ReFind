function normalise(value) {
  return String(value || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function datesApart(first, second) {
  const a = new Date(`${first}T12:00:00Z`).getTime();
  const b = new Date(`${second}T12:00:00Z`).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86_400_000 : 999;
}

export function calculateMatch(left, right) {
  let score = 0;
  const reasons = [];
  if (normalise(left.category) === normalise(right.category)) { score += 30; reasons.push("same category"); }
  if (normalise(left.location) === normalise(right.location)) { score += 25; reasons.push("same location"); }
  if (left.color && right.color && normalise(left.color) === normalise(right.color)) { score += 15; reasons.push("same color"); }
  if (left.brand && right.brand && normalise(left.brand) === normalise(right.brand)) { score += 15; reasons.push("same brand"); }
  const days = datesApart(left.reported_date, right.reported_date);
  if (days <= 3) { score += 15; reasons.push("reported within 3 days"); }
  else if (days <= 7) { score += 10; reasons.push("reported within 1 week"); }
  else if (days <= 14) { score += 5; reasons.push("reported within 2 weeks"); }
  return { score, reasons };
}
