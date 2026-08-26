import { initialiseDatabase, normaliseEmail, one, run } from "./db.mjs";

const email = normaliseEmail(process.argv[2]);
if (!email) {
  console.error("Usage: npm run make-admin -- your-email@example.com");
  process.exitCode = 1;
} else {
  try {
    await initialiseDatabase();
    const user = await one("SELECT id, name FROM users WHERE lower(email) = lower($1)", [email]);
    if (!user) {
      console.error("No registered account was found for that email. Register in Campus ReFind first.");
      process.exitCode = 1;
    } else {
      await run("UPDATE users SET role = 'admin' WHERE id = $1", [user.id]);
      console.log(`${user.name} is now an administrator.`);
    }
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  }
}
