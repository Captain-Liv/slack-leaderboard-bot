const { App, ExpressReceiver } = require('@slack/bolt');
require('dotenv').config();

// Receiver setup
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: '/slack/events'
});

// App setup
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver
});

// Admin ID
const allowedUser = 'U01F9QU9JLD';

// In-memory message store
const messageCounts = {}; // { userId: { total: X, channels: { channelId: count } } }

// Track messages in all public channels
app.event('message', async ({ event }) => {
  if (!event.bot_id && event.user && event.channel) {
    const userId = event.user;
    const channelId = event.channel;

    if (!messageCounts[userId]) {
      messageCounts[userId] = { total: 0, channels: {} };
    }

    messageCounts[userId].total += 1;

    if (!messageCounts[userId].channels[channelId]) {
      messageCounts[userId].channels[channelId] = 0;
    }

    messageCounts[userId].channels[channelId] += 1;

    console.log(`📨 ${userId} sent a message in ${channelId}. Total: ${messageCounts[userId].total}`);
  }
});

// Slash command: /leaderboard (global top 100)
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

// Slash command: /leaderboard_channel (top 100 in current channel)
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

// Start the bot
(async () => {
  const port = process.env.PORT || 3000;
  await app.start(port);
  console.log(`⚡️ Slack bot running on port ${port}`);
})();
