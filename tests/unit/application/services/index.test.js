const serviceExports = require('../../../../src/application/services');
const ActionPayloadCodec = require('../../../../src/application/services/ActionPayloadCodec');
const ExternalReviewSessionService = require('../../../../src/application/services/ExternalReviewSessionService');
const NotificationRouter = require('../../../../src/application/services/NotificationRouter');
const PRActionHandler = require('../../../../src/application/services/PRActionHandler');
const ReviewPromptBuilder = require('../../../../src/application/services/ReviewPromptBuilder');
const StateCoordinationService = require('../../../../src/application/services/StateCoordinationService');
const UnifiedStateService = require('../../../../src/application/services/UnifiedStateService');

describe('application services index exports', () => {
  test('re-exports service modules', () => {
    expect(serviceExports).toEqual({
      ActionPayloadCodec,
      ExternalReviewSessionService,
      NotificationRouter,
      PRActionHandler,
      ReviewPromptBuilder,
      StateCoordinationService,
      UnifiedStateService
    });
  });
});
