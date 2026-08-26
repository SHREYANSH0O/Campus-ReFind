import { initialiseDatabase, run } from "./db.mjs";

// These were the exact accounts used for the original starter examples.
// Deleting the accounts also removes their reports, claims, and notifications.
const demoEmails = ["admin@campus.edu", "student@campus.edu", "diya@campus.edu"];

try {
  await initialiseDatabase();
  const placeholders = demoEmails.map((_, index) => `$${index + 1}`).join(", ");
  const result = await run(`DELETE FROM users WHERE lower(email) IN (${placeholders})`, demoEmails);
  console.log(`Removed ${result.rowCount} starter account${result.rowCount === 1 ? "" : "s"} and their related demo data.`);
} catch (error) {
  console.error(error.message || error);
  process.exitCode = 1;
}
