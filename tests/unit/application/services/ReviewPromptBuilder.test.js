const fs = require('fs');
const os = require('os');
const path = require('path');
const ReviewPromptBuilder = require('../../../../src/application/services/ReviewPromptBuilder');

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
});
