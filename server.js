const { App, ExpressReceiver } = require('@slack/bolt');
require('dotenv').config();

const axios = require('axios');

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

const allowedUser = 'U01F9QU9JLD'; // your admin ID
const messageCounts = {}; // { userId: { total: X, channels: { channelId: count } } }

// Real-time message tracker
app.event('message', async ({ event }) => {
  if (!event.bot_id && event.user && event.channel) {
    incrementMessage(event.user, event.channel);
  }
});

// Helper: count messages
function incrementMessage(userId, channelId) {
  if (!messageCounts[userId]) {
    messageCounts[userId] = { total: 0, channels: {} };
  }
  messageCounts[userId].total += 1;
  if (!messageCounts[userId].channels[channelId]) {
    messageCounts[userId].channels[channelId] = 0;
  }
  messageCounts[userId].channels[channelId] += 1;
}

// /leaderboard (global top 100)
app.command('/leaderboard', async ({ command, ack, respond }) => {
  await ack();
  if (command.user_id !== allowedUser) {
    await respond("⛔ This command is only available to admins.");
    return;
  }

  const sorted = Object.entries(messageCounts)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 100);

  if (sorted.length === 0) {
    await respond("No messages tracked yet.");
    return;
  }

  const leaderboard = sorted
    .map(([userId, data], i) => `${i + 1}. <@${userId}> — ${data.total} messages`)
    .join('\n');

  await respond(`🏆 *Top 100 Most Active Members:*\n${leaderboard}`);
});

// /leaderboard_channel (top 100 per channel)
app.command('/leaderboard_channel', async ({ command, ack, respond }) => {
  await ack();
  if (command.user_id !== allowedUser) {
    await respond("⛔ This command is only available to admins.");
    return;
  }

  const channelId = command.channel_id;

  const userCounts = Object.entries(messageCounts)
    .filter(([_, data]) => data.channels[channelId])
    .map(([userId, data]) => ({
      userId,
      count: data.channels[channelId]
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 100);

  if (userCounts.length === 0) {
    await respond("No activity in this channel yet.");
    return;
  }

  const text = userCounts
    .map((entry, i) => `${i + 1}. <@${entry.userId}> — ${entry.count} messages`)
    .join('\n');

  await respond(`🏆 *Top 100 Members in <#${channelId}>:*\n${text}`);
});

// /backfill (fetch last 90 days)
app.command('/backfill', async ({ command, ack, respond, client }) => {
  await ack();
  if (command.user_id !== allowedUser) {
    await respond("⛔ This command is only available to admins.");
    return;
  }

  await respond("📦 Backfilling messages... this may take a moment.");

  const now = Math.floor(Date.now() / 1000);
  const oldest = now - 90 * 24 * 60 * 60;

  try {
    // Get all public channels
    const channelsList = await client.conversations.list({ types: 'public_channel', limit: 1000 });
    const channels = channelsList.channels || [];

    for (const channel of channels) {
      let hasMore = true;
      let cursor = undefined;

      while (hasMore) {
        const history = await client.conversations.history({
          channel: channel.id,
          oldest,
          limit: 200,
          cursor
        });

        const messages = history.messages || [];
        for (const msg of messages) {
          if (msg.user && !msg.bot_id) {
            incrementMessage(msg.user, channel.id);
          }
        }

        hasMore = history.has_more;
        cursor = history.response_metadata?.next_cursor;
      }
    }

    await respond("✅ Backfill complete. Messages from the last 90 days have been counted.");
  } catch (err) {
    console.error("Backfill error:", err);
    await respond("❌ Backfill failed. Check the logs for details.");
  }
});

// Start server
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Slack bot running on port ${port}`);
})();
