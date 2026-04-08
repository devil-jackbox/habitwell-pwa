const admin = require('firebase-admin');

// ── Init ──────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db        = admin.firestore();
const messaging = admin.messaging();

// ── Current UTC hour (what the cron just triggered for) ───
const currentUTCHour = new Date().getUTCHours();
console.log(`Running for UTC hour: ${currentUTCHour}`);

// ── Optional: test mode (send to one user only) ───────────
const TEST_UID = process.env.TEST_UID || null;

// ── Main ──────────────────────────────────────────────────
async function sendReminders() {
  let query = db.collection('users')
    .where('notifEnabled', '==', true)
    .where('fcmToken', '!=', null);

  // In test mode, only one user
  if (TEST_UID) {
    query = db.collection('users').where('__name__', '==', TEST_UID);
  }

  const snapshot = await query.get();

  if (snapshot.empty) {
    console.log('No users to notify.');
    return;
  }

  console.log(`Found ${snapshot.size} eligible users`);

  const results = { sent: 0, skipped: 0, failed: 0, tokensToDelete: [] };

  const sendPromises = snapshot.docs.map(async (userDoc) => {
    const uid  = userDoc.id;
    const data = userDoc.data();

    const token           = data.fcmToken;
    const preferredHour   = data.reminderHour ?? 8;   // default 8 AM UTC if not set
    const reminderMessage = data.reminderMessage || "Your habits are waiting — keep that streak alive! 🔥";

    // Skip if this user's preferred hour doesn't match current UTC hour
    // (unless we're in test mode)
    if (!TEST_UID && preferredHour !== currentUTCHour) {
      results.skipped++;
      return;
    }

    if (!token) {
      results.skipped++;
      return;
    }

    const message = {
      token,
      notification: {
        title: '⚡ HabitWell OS',
        body:  reminderMessage
      },
      webpush: {
        notification: {
          title:   '⚡ HabitWell OS',
          body:    reminderMessage,
          icon:    'https://devil-jackbox.github.io/habitwell-pwa/icons/icon-192.png',
          badge:   'https://devil-jackbox.github.io/habitwell-pwa/icons/icon-96.png',
          tag:     'habitwell-reminder',
          renotify: false,
          requireInteraction: false
        },
        fcmOptions: {
          link: 'https://devil-jackbox.github.io/habitwell-pwa/'
        }
      }
    };

    try {
      const response = await messaging.send(message);
      console.log(`✅ Sent to ${uid}: ${response}`);
      results.sent++;
    } catch (err) {
      const errCode = err.errorInfo?.code || err.code;

      // Token is expired/unregistered — queue for cleanup
      if (
        errCode === 'messaging/registration-token-not-registered' ||
        errCode === 'messaging/invalid-registration-token'
      ) {
        console.warn(`🗑️  Stale token for ${uid} — will delete`);
        results.tokensToDelete.push(uid);
      } else {
        console.error(`❌ Failed for ${uid}:`, errCode, err.message);
      }
      results.failed++;
    }
  });

  await Promise.allSettled(sendPromises);

  // ── Cleanup stale tokens ──────────────────────────────
  if (results.tokensToDelete.length > 0) {
    console.log(`Cleaning ${results.tokensToDelete.length} stale tokens...`);
    const deletePromises = results.tokensToDelete.map(uid =>
      db.collection('users').doc(uid).update({
        fcmToken:      admin.firestore.FieldValue.delete(),
        notifEnabled:  false,
        tokenDeletedAt: new Date().toISOString()
      })
    );
    await Promise.allSettled(deletePromises);
  }

  // ── Summary ───────────────────────────────────────────
  console.log('─────────────────────────────');
  console.log(`Sent:    ${results.sent}`);
  console.log(`Skipped: ${results.skipped}`);
  console.log(`Failed:  ${results.failed}`);
  console.log(`Cleaned: ${results.tokensToDelete.length} stale tokens`);
}

sendReminders().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
