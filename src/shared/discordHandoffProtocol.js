const DISCORD_HANDOFF_PROTOCOL = 'agent-pr-handoff/v1';

const DiscordHandoffMessageType = Object.freeze({
  PROMPT_REQUEST: 'prompt_request',
  PROGRESS: 'progress',
  FINAL_REVIEW: 'final_review',
  FINAL_STATUS: 'final_status',
  ERROR: 'error'
});

module.exports = {
  DISCORD_HANDOFF_PROTOCOL,
  DiscordHandoffMessageType
};
