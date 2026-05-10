import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false }
});

const rl = createInterface({ input, output });

try {
  const email = (await rl.question('Admin email: ')).trim();
  const username = (await rl.question('Admin username: ')).trim();
  const password = await rl.question('Admin password: ');

  if (!email || !username || !password) {
    throw new Error('Email, username, and password are required.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const { error } = await supabase
    .from('logins')
    .upsert({ id: 1, email, username, password_hash: passwordHash, password: null }, { onConflict: 'id' });

  if (error) throw error;
  console.log('Admin login updated.');
} finally {
  rl.close();
}
