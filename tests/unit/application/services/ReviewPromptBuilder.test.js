const fs = require('fs');
const os = require('os');
const path = require('path');
const ReviewPromptBuilder = require('../../../../src/application/services/ReviewPromptBuilder');
const {
  DISCORD_HANDOFF_PROTOCOL,
  DiscordHandoffMessageType
} = require('../../../../src/shared/discordHandoffProtocol');

describe('ReviewPromptBuilder', () => {
  test('renders review prompt placeholders and context blocks', () => {
    const tmpFile = path.join(os.tmpdir(), `review-template-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, [
      '#{{PR_NUMBER}} {{LEVEL}} {{FOCUS_AREAS}} {{MAX_COMMENTS}}',
      '{{OWNER}}/{{REPO}} {{SOURCE_BRANCH}} -> {{TARGET_BRANCH}}',
      '{{PR_URL}} {{MCP_NAME}}',
      '{{PREVIOUS_COMMENTS}}',
      '{{LAST_COMMITS}}'
    ].join('\n'));

    const builder = new ReviewPromptBuilder({
      templatePath: tmpFile,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    const prompt = builder.build({
      owner: 'acme',
      repo: 'api',
      pr: {
        number: 7,
        headBranch: 'feature',
        baseBranch: 'main',
        url: 'https://github.com/acme/api/pull/7'
      },
      level: 'high',
      levelConfig: {
        focusAreas: ['security', 'performance'],
        maxCommentsPerFile: 10
      },
      mcpName: 'github-work',
      previousComments: [{ path: 'src/app.js', line: 12, body: 'Fix this' }],
      lastCommits: [{ sha: 'abc123', message: 'fix auth', author: 'dev' }]
    });

    expect(prompt).toContain('#7 HIGH security, performance 10');
    expect(prompt).toContain('acme/api feature -> main');
    expect(prompt).toContain('https://github.com/acme/api/pull/7 github-work');
    expect(prompt).toContain('File: src/app.js, Line: 12');
    expect(prompt).toContain('[abc123] fix auth (oleh dev)');

    fs.unlinkSync(tmpFile);
  });

  test('uses default placeholders when comments, commits, and branch data are absent', () => {
    const tmpFile = path.join(os.tmpdir(), `review-template-${Date.now()}-minimal.txt`);
    fs.writeFileSync(tmpFile, '{{SOURCE_BRANCH}} {{TARGET_BRANCH}} {{PREVIOUS_COMMENTS}} {{LAST_COMMITS}}');

    const builder = new ReviewPromptBuilder({
      templatePath: tmpFile,
      logger: { info: jest.fn(), error: jest.fn() }
    });

    const prompt = builder.build({
      owner: 'acme',
      repo: 'api',
      pr: { number: 8, url: 'https://example.com' },
      level: 'high',
      levelConfig: { focusAreas: [], maxCommentsPerFile: 3 }
    });

    expect(prompt).toContain('unknown main');
    expect(prompt).toContain('(Tidak ada komentar review sebelumnya)');
    expect(prompt).toContain('(Tidak ada commit info)');

    fs.unlinkSync(tmpFile);
  });

  test('throws for invalid review level config and missing template', () => {
    const builder = new ReviewPromptBuilder({
      templatePath: path.join(os.tmpdir(), `missing-template-${Date.now()}.txt`),
      logger: { info: jest.fn(), error: jest.fn() }
    });

    expect(() => builder.build({
      owner: 'acme',
      repo: 'api',
      pr: { number: 8, url: 'https://example.com' },
      level: 'high',
      levelConfig: null
    })).toThrow('Invalid review level: high');

    expect(() => builder._loadTemplate('acme', 'api')).toThrow('Prompt template not found');
  });

  test('replaceAll swaps missing values with empty strings', () => {
    const builder = new ReviewPromptBuilder();

    expect(builder._replaceAll('{{A}} {{B}}', { A: 'x', B: null })).toBe('x ');
  });

  test('builds Discord handoff prompt with explicit protocol contract', () => {
    const builder = new ReviewPromptBuilder();

    const handoff = builder.buildDiscordHandoff({
      mentionBotName: '<@123>',
      sessionId: 'qi_123',
      basePrompt: 'BASE PROMPT'
    });

    expect(handoff.triggerContent).toContain('SESSION_ID: qi_123');
    expect(handoff.triggerContent).toContain(`protocol ${DISCORD_HANDOFF_PROTOCOL}`);
    expect(handoff.triggerContent).toContain(`"message_type":"${DiscordHandoffMessageType.PROMPT_REQUEST}"`);
    expect(handoff.detailContent).toContain(`"session_id":"qi_123"`);
    expect(handoff.detailContent).toContain(`"message_type":"${DiscordHandoffMessageType.PROMPT_REQUEST}"`);
    expect(handoff.detailContent).toContain(`"message_type":"${DiscordHandoffMessageType.FINAL_REVIEW}"`);
    expect(handoff.detailContent).toContain('BASE PROMPT');
  });
});
