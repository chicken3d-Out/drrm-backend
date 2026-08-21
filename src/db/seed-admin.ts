import { query, pool } from '../config/db';
import { hashPassword, isDepedEmail } from '../modules/auth/auth.service';

async function main() {
  const args = process.argv.slice(2);
  const emailArg = args.find((a) => a.startsWith('--email='))?.split('=')[1];
  const passwordArg = args.find((a) => a.startsWith('--password='))?.split('=')[1];

  if (!emailArg || !passwordArg) {
    console.error('Usage: npm run seed:admin -- --email=admin@deped.gov.ph --password=YourPassword123!');
    process.exit(1);
  }
  if (!isDepedEmail(emailArg)) {
    console.error('Admin email must be a @deped.gov.ph address.');
    process.exit(1);
  }

  const existing = await query('SELECT id FROM users WHERE email = $1', [emailArg]);
  if (existing.rows.length > 0) {
    console.error('A user with this email already exists.');
    process.exit(1);
  }

  const passwordHash = await hashPassword(passwordArg);
  const userResult = await query(
    `INSERT INTO users (email, password_hash, status) VALUES ($1, $2, 'APPROVED') RETURNING id`,
    [emailArg, passwordHash]
  );
  const userId = userResult.rows[0].id;

  await query(`INSERT INTO user_profiles (user_id, full_name) VALUES ($1, $2)`, [userId, 'DRRM Administrator']);
  await query(`INSERT INTO notification_preferences (user_id) VALUES ($1)`, [userId]);

  const roleResult = await query(`SELECT id FROM roles WHERE name = 'DRRM_ADMIN'`);
  await query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [userId, roleResult.rows[0].id]);

  console.log(`DRRM Administrator account created: ${emailArg}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
