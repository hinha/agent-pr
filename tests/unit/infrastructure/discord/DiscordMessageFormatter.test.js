jest.mock('discord.js', () => require('../../../../__mocks__/discord.js'));

const DiscordMessageFormatter = require('../../../../src/infrastructure/discord/DiscordMessageFormatter');

describe('DiscordMessageFormatter', () => {
  let formatter;

  beforeEach(() => {
    formatter = new DiscordMessageFormatter();
  });

  test('builds PR embed and action components', () => {
    const payload = formatter.buildPRNotification({
      owner: 'acme',
      repo: 'api',
      pr: {
        id: 123,
        number: 7,
        title: 'Add API',
        url: 'https://github.com/acme/api/pull/7',
        createdAt: '2026-06-11T00:00:00Z'
      },
      summary: {
        riskLevel: 'HIGH',
        impactArea: 'api',
        purpose: 'Add API',
        filesChanged: 2,
        diffSize: 30
      }
    }, { instanceIdx: 0, repoIdx: 1 });

    expect(payload.embeds[0].data.title).toBe('New PR: Add API');
    expect(payload.embeds[0].data.color).toBe(0xef4444);
    expect(payload.components[0].components[0].data.custom_id).toBe('review_now:0:1:123');
    expect(payload.components[0].components[1].data.url).toBe('https://github.com/acme/api/pull/7');
  });

  test('builds outdated review components', () => {
    const payload = formatter.buildOutdatedReviewNotification({
      owner: 'acme',
      repo: 'api',
      pr: {
        id: 123,
        number: 7,
        title: 'Add API',
        url: 'https://github.com/acme/api/pull/7'
      },
      reviewState: { id: 'review-1' },
      reviewUser: 'reviewer',
      outdatedCommit: 'abcdef123',
      currentCommit: '123456789'
    }, { instanceIdx: 0, repoIdx: 1 });

    expect(payload.embeds[0].data.title).toContain('Outdated review');
    expect(payload.embeds[0].data.fields[0].value).toBe('reviewer: review-1');
    expect(payload.components[0].components[0].data.custom_id).toBe('approve_outdated:0:1:123:review-1');
    expect(payload.components[1].components[1].data.custom_id).toBe('dismiss_outdated:0:1:123:review-1');
  });

  test('builds level and silent components', () => {
    const levelComponents = formatter.buildLevelComponents(
      { agent: { level: ['low', 'high'] } },
      { instanceIdx: 0, repoIdx: 1 },
      { id: 123 },
      'review_level_outdated',
      'review-1'
    );
    const silentComponents = formatter.buildSilentComponents({ instanceIdx: 0, repoIdx: 1 }, { id: 123 });

    expect(levelComponents[0].components[0].data.custom_id).toBe('review_level_outdated:0:1:123:review-1:low');
    expect(levelComponents[0].components[1].data.custom_id).toBe('review_level_outdated:0:1:123:review-1:high');
    expect(silentComponents[0].components[0].data.custom_id).toBe('silent_dur:0:1:123:3');
  });

  test('builds queue completion and failure embeds', () => {
    const completed = formatter.buildQueueCompleted({
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add API',
      level: 'medium',
      duration: 120000,
      reviewUrl: 'https://github.com/acme/api/pull/7#review'
    });
    const failed = formatter.buildQueueFailed({
      instanceKey: 'github/acme',
      repoName: 'api',
      prNumber: 7,
      prTitle: 'Add API',
      level: 'medium',
      error: 'boom'
    });

    expect(completed.embeds[0].data.title).toBe('Review Completed');
    expect(completed.embeds[0].data.url).toBe('https://github.com/acme/api/pull/7#review');
    expect(failed.embeds[0].data.title).toBe('Review Failed');
    expect(failed.embeds[0].data.fields[2].value).toBe('boom');
  });

  test('maps all risk colors and truncates long values', () => {
    expect(formatter._riskColor('MEDIUM')).toBe(0xf59e0b);
    expect(formatter._riskColor('LOW')).toBe(0x22c55e);
    expect(formatter._riskColor('unknown')).toBe(0x94a3b8);
    expect(formatter._shortSha()).toBe('unknown');
    expect(formatter._truncate('abcdef', 5)).toBe('ab...');
  });
});
