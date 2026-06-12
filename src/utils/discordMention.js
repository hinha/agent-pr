function extractDiscordUserIdFromMention(mention) {
  const match = String(mention || '').trim().match(/^<@!?(\d+)>$/);
  return match ? match[1] : null;
}

function isDiscordUserMention(mention) {
  return Boolean(extractDiscordUserIdFromMention(mention));
}

module.exports = {
  extractDiscordUserIdFromMention,
  isDiscordUserMention
};
