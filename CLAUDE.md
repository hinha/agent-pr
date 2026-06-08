# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Production-grade Node.js daemon that monitors GitHub PRs across multiple instances and repositories using the OpenClaw MCP (Model Context Protocol) tools and provides AI-powered code reviews with Telegram notifications.

## Development Commands

```bash
# Install dependencies
npm install

# Run in development mode (auto-restart on changes)
npm run dev

# Run in production
npm start

# Build for production (pkg - creates standalone Linux binary)
npm run build

# Run tests
npm test                          # All tests
npm run test:watch               # Watch mode
npm run test:coverage            # With coverage report
npm run test:ci                  # CI mode with coverage

# View logs in real-time
tail -f logs/combined.log  # All logs
tail -f logs/error.log     # Errors only
```

## Architecture

This project follows **Clean Architecture** principles with four distinct layers. The key insight is that dependencies point inward - the domain layer has no dependencies on outer layers.

```
┌─────────────────────────────────────────────────────────────┐
│                    Presentation Layer                        │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │   CLI Interface  │  │  Telegram Bot    │               │
│  │   (Bootstrap)    │  │  (Callbacks)     │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                          │
│  ┌──────────────────────────────────────────────────┐      │
│  │         Use Cases (Business Logic Orchestration)      │      │
│  │  • ProcessPRUseCase  • SendNotificationUseCase     │      │
│  │  • ReviewPRUseCase   • CheckOutdatedReviewsUseCase │      │
│  └──────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │         Orchestrators (Workflow Coordination)      │      │
│  │  • PRProcessingOrchestrator                         │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                      Domain Layer                            │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ Domain Entities  │  │  Domain Services │               │
│  │ • PullRequest    │  │  • PRAnalyzer    │               │
│  │ • Review         │  │  • RiskCalculator│               │
│  │ • Repository     │  │  • PRStateMachine│               │
│  │ • Instance       │  │  • EventBus      │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                       │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ External Services│  │  State Storage   │               │
│  │ • MCP GitHub     │  │  • FileSystem    │               │
│  │ • Telegram       │  │  • InMemory     │               │
│  │ • OpenClaw Agent │  │                  │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── bootstrap/                    # Application composition root
│   └── Bootstrap.js           # Startup/shutdown orchestration
├── core/                         # Domain layer (no external dependencies)
│   ├── entities/                # Domain entities with business logic
│   │   ├── PullRequest.js
│   │   ├── Review.js
│   │   ├── Repository.js
│   │   ├── Instance.js
│   │   ├── FileChange.js
│   │   └── ReviewComment.js
│   └── services/                # Domain services
│       ├── PRAnalyzerService.js
│       ├── RiskCalculatorService.js
│       └── PRStateMachine.js
├── application/                  # Application layer
│   ├── use-cases/               # Business logic orchestration
│   │   ├── ProcessPRUseCase.js
│   │   ├── SendNotificationUseCase.js
│   │   ├── ReviewPRUseCase.js
│   │   └── CheckOutdatedReviewsUseCase.js
│   ├── orchestrators/            # Workflow coordination
│   │   └── PRProcessingOrchestrator.js
│   └── services/                # Application services
│       ├── StateCoordinationService.js
│       └── UnifiedStateService.js
├── infrastructure/               # Infrastructure layer
│   ├── github/                  # GitHub operations
│   │   ├── MCPGitHubAdapter.js
│   │   └── GitHubAdapterFactory.js
│   ├── telegram/                 # Telegram integration
│   │   ├── TelegramBotAdapter.js
│   │   └── CallbackHandler.js
│   ├── agents/                   # AI agents
│   │   └── OpenClawAgentAdapter.js
│   └── persistence/               # State persistence
│       ├── FileSystemStateRepository.js
│       └── InMemoryStateRepository.js
├── interfaces/                   # Interface definitions (contracts)
│   ├── IStateRepository.js
│   ├── IGitHubService.js
│   ├── ITelegramService.js
│   └── IAgentService.js
├── shared/                       # Cross-cutting concerns
│   ├── events/                  # Event system
│   │   └── EventBus.js
│   ├── errors/                  # Custom error types
│   ├── utils/                   # Shared utilities
│   │   └── RetryHelper.js
│   └── logging/                 # Logging
│       └── LoggerFactory.js
├── container/                    # DI container (Awilix)
│   ├── Container.js
│   └── bindings.js
└── config/                       # Configuration
    └── yamlConfig.js
```

### Dependency Injection (Awilix)

The application uses Awilix for dependency injection. All dependencies are registered in `src/container/Container.js`:

```javascript
// Get any dependency from the container
const container = require('./src/container/Container');
const logger = container.get('logger');
const orchestrator = container.get('prProcessingOrchestrator');

// The container supports three lifecycles:
// - SINGLETON: One instance for the application lifetime
// - SCOPED: One instance per scope
// - TRANSIENT: New instance each time
```

When adding new services:
1. Create the service class
2. Register it in `Container.js` using `registerClass()`, `registerFunction()`, or `registerValue()`
3. Inject it into dependent classes via the container

### Configuration

Uses YAML-based configuration in `config.yml`:

```yaml
app:
  mcp_client: mcporter  # or "openclaw mcp" for native OpenClaw
  check_interval_minutes: 7
  telegram:
    bot_token: xxx
    chat_id: xxx
  flagsmith:
    enabled: true
    environment_id: xxx

github/organization-name:
  mcp_name: github-work
  max_age_hours: 48
  agent:
    review: main
    level: [low, medium, high]
  repos:
    repo-name:
      thread_id: 12345
```

**Key configuration options:**
- `app.check_interval_minutes`: PR polling frequency
- `app.outdated_review_check_minutes`: Outdated review check frequency (0 = disabled)
- `app.snooze_time`: Quiet hours for notifications
- `app.flagsmith`: Remote configuration via Flagsmith
- `{instance}.mcp_name`: MCP server name for this instance
- `{instance}.max_age_hours`: Maximum PR age to process
- `{instance}.skip_cache_duration_hours`: Skip cache duration

### MCP-First Design

All GitHub operations use MCP tools via a configurable CLI client (`app.mcp_client` in config.yml):
- Default: `mcporter` CLI
- Alternative: `openclaw mcp` for native OpenClaw MCP support

Both clients use the same format: `<client> call <server.tool> --output json key=value`
- `list_pull_requests` - Fetch open PRs
- `get_pull_request_files` - Get changed file metadata
- `create_pull_request_review` - Submit reviews with line comments
- `update_pull_request` - Close PRs

### Domain Layer

**Entities** (`src/core/entities/`): Rich domain models with encapsulated business logic:
- `PullRequest` - PR data with risk analysis, notification tracking
- `Review` - Review with comments, state management
- `Repository` - Repository metadata
- `Instance` - GitHub instance configuration
- `FileChange` - Changed file with analysis
- `ReviewComment` - Review comment with position

**Domain Services** (`src/core/services/`):
- `PRAnalyzerService` - Analyzes PR risk, impact area, suspicious patterns
- `RiskCalculatorService` - Calculates risk levels based on size and patterns
- `PRStateMachine` - Manages PR state transitions with validation

### Application Layer

**Use Cases** (`src/application/use-cases/`): Orchestrate business logic:
- `ProcessPRUseCase` - End-to-end PR processing workflow
- `SendNotificationUseCase` - Telegram notification formatting and sending
- `ReviewPRUseCase` - AI review submission
- `CheckOutdatedReviewsUseCase` - Detects outdated reviews

**Orchestrators** (`src/application/orchestrators/`):
- `PRProcessingOrchestrator` - Main workflow coordinator, polling loop

**Services** (`src/application/services/`):
- `StateCoordinationService` - Unified state management facade
- `UnifiedStateService` - Consolidates all state management

### Infrastructure Layer

**Adapters** implement interfaces and abstract external services:
- `MCPGitHubAdapter` - GitHub operations via MCP
- `TelegramBotAdapter` - Telegram bot with thread routing, callback handling
- `OpenClawAgentAdapter` - AI review execution via OpenClaw CLI
- `FileSystemStateRepository` / `InMemoryStateRepository` - State persistence

### Callback Data Format

Uses compact format to stay within Telegram's 64-byte limit:
- Standard: `action:instanceIdx:repoIdx:prId` (4 parts)
- Review level: `review_level:instanceIdx:repoIdx:prId:level` (5 parts)

### State Management

Repository-scoped state persisted to `data/instances/{org}/{repo}/`:
- `processed_prs.json` - Fully processed PRs (after 3 notifications or approval)
- `notification_counts.json` - Notification counts per PR (max 3)
- `skip_cache.json` - Temporary skips with expiry timestamps
- `processed_timestamps.json` - When PRs were marked as processed

### EventBus Pattern

The `EventBus` (`src/shared/events/EventBus.js`) enables decoupled communication:
```javascript
// Emit events
await eventBus.emitAsync('pr.processed', { prId, repo });
await eventBus.emitAsync('review.submitted', { reviewId, prId });

// Subscribe to events
eventBus.on('pr.processed', (data) => { /* handle */ });
```

Common events: `pr.processed`, `pr.notified`, `review.submitted`, `pr.approved`, `application.started`, `application.stopped`

### Retry Pattern

All external operations use `RetryHelper` with exponential backoff:
- MCP calls: 3 retries, 2s base, 2x multiplier
- Telegram: 3 retries, 3s base, 2x multiplier
- AI agents: 2 retries, 10s base, 2x multiplier

### Testing

Test files mirror the source structure in `tests/`:
- `tests/unit/core/` - Domain layer tests
- `tests/unit/application/` - Application layer tests
- `tests/unit/infrastructure/` - Infrastructure tests
- `tests/unit/shared/` - Cross-cutting concerns tests
- `tests/integration/` - Integration tests

Coverage is enforced at 90% (branches, functions, lines, statements).

```bash
# Run specific test file
npm test -- tests/unit/core/entities/PullRequest.test.js

# Run tests matching pattern
npm test -- --testPathPatterns="integration"
```

### Telegram Bot Actions

Inline buttons trigger workflows:
- **Review Now** → Shows level selection (Low/Medium/High)
- **Approve** → Submits APPROVE review via MCP, marks PR as processed
- **Reject** → Submits REQUEST_CHANGES review
- **Close PR** → Closes PR via MCP
- **Skip (3h)** → Suppresses notifications for 3 hours

### Error Isolation

Process continues on uncaught exceptions to prevent restart loops. Each PR processing is isolated - failures don't block other PRs. The `ErrorHandler` (`src/shared/errors/ErrorHandler.js`) centralizes error handling and emits events for monitoring.

### Adding New Features

1. **New Domain Entity**: Create in `src/core/entities/` with business logic
2. **New Domain Service**: Create in `src/core/services/`, keep pure business logic
3. **New Use Case**: Create in `src/application/use-cases/`, orchestrate domain services
4. **New Adapter**: Implement interface in `src/infrastructure/`, register in Container
5. **New Event**: Emit via EventBus, document in comments
6. **Register**: Add to `Container.js` with appropriate lifecycle

### Time Zone

Logs use Asia/Jakarta (GMT+7) timestamp format.
