const ActionPayloadCodec = require('../../../../src/application/services/ActionPayloadCodec');

describe('ActionPayloadCodec', () => {
  test('parses existing Telegram callback strings', () => {
    expect(ActionPayloadCodec.parse('review_level_outdated:0:1:12345:r9:high')).toEqual({
      action: 'review_level_outdated',
      instanceIdx: 0,
      repoIdx: 1,
      prId: '12345',
      reviewId: 'r9',
      level: 'high'
    });
  });

  test('formats Discord-safe custom ids using the same callback contract', () => {
    expect(ActionPayloadCodec.format({
      action: 'silent_dur',
      instanceIdx: 0,
      repoIdx: 1,
      prId: 12345,
      hours: 8
    })).toBe('silent_dur:0:1:12345:8');
  });

  test('rejects malformed silent durations', () => {
    expect(ActionPayloadCodec.parse('silent_dur:0:1:12345:5')).toBeNull();
    expect(ActionPayloadCodec.parse('silent_dur:0:1:12345:abc')).toBeNull();
  });
});
