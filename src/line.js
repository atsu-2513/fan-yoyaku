const line = require('@line/bot-sdk');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

async function pushText(lineUserId, text) {
  await client.pushMessage({
    to: lineUserId,
    messages: [{ type: 'text', text }],
  });
}

async function replyText(replyToken, text) {
  await client.replyMessage({
    replyToken,
    messages: [{ type: 'text', text }],
  });
}

module.exports = { config, client, pushText, replyText };
