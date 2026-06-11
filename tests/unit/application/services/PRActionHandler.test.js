const PRActionHandler = require('../../../../src/application/services/PRActionHandler');
const ActionPayloadCodec = require('../../../../src/application/services/ActionPayloadCodec');

describe('PRActionHandler', () => {
  test('Discord review level sends rendered Hermes mention prompt', async () => {
    const githubInstance = {
      getOpenPRs: jest.fn().mockResolvedValue([
        {
          id: 123,
          number: 9,
          title: 'Improve API',
          owner: 'acme',
          repo: 'api',
          author: 'dev',
          url: 'https://github.com/acme/api/pull/9',
          headBranch: 'feature/api',
          baseBranch: 'main',
          headSha: 'abc'
        }
      ]),
      getPRComments: jest.fn().mockResolvedValue([{ path: 'src/api.js', line: 2, body: 'Old comment' }]),
      getPRCommits: jest.fn().mockResolvedValue([{ sha: 'abc', message: 'fix', author: 'dev' }])
    };
    const discordAdapter = {
      sendHermesMention: jest.fn().mockResolvedValue({ success: true, id: 'm1' })
    };
    const responder = {
      deferUpdate: jest.fn().mockResolvedValue(),
      update: jest.fn().mockResolvedValue(),
      error: jest.fn().mockResolvedValue()
    };
    const handler = new PRActionHandler({
      githubAdapter: { create: jest.fn().mockReturnValue(githubInstance) },
      discordAdapter,
      reviewPromptBuilder: {
        build: jest.fn().mockReturnValue('RENDERED PROMPT')
      },
      eventBus: { emitAsync: jest.fn().mockResolvedValue() },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      config: {
        app: {
          discord: {
            enabled: true,
            mentionBotName: '<@123456789012345678>',
            reviewMode: 'mention_hermes'
          }
        },
        reviewLevels: {
          high: { focusAreas: ['security'], maxCommentsPerFile: 10 }
        },
        instances: {
          'github/acme': {
            key: 'github/acme',
            owner: 'acme',
            mcpName: 'github-work',
            repos: {
              api: { name: 'api', discordChannelId: 'channel-1' }
            }
          }
        }
      }
    });

    const result = await handler.handleDiscordInteraction({
      customId: ActionPayloadCodec.format({
        action: 'review_level',
        instanceIdx: 0,
        repoIdx: 0,
        prId: 123,
        level: 'high'
      })
    }, responder);

    expect(result.success).toBe(true);
    expect(discordAdapter.sendHermesMention).toHaveBeenCalledWith(expect.objectContaining({
      mentionBotName: '<@123456789012345678>',
      content: '<@123456789012345678>\nRENDERED PROMPT'
    }));
    expect(responder.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Hermes review prompt sent')
    }));
  });
});
