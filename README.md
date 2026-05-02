# Multi-Instance PR Monitor Daemon

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![PM2](https://img.shields.io/badge/pm2-compatible-orange)](https://pm2.keymetrics.io)
[![Architecture](https://img.shields.io/badge/architecture-clean--success.svg)]()

A production-grade Node.js daemon that monitors GitHub Pull Requests across multiple instances and repositories using OpenClaw MCP (Model Context Protocol) tools, provides AI-powered code reviews with configurable intensity levels, and delivers real-time notifications via Telegram bot.

## Overview

This daemon is designed for teams that want automated PR monitoring with intelligent code review capabilities without managing complex infrastructure. It polls GitHub for open PRs, tracks notification history, and provides actionable insights through Telegram notifications with inline action buttons.

### Key Features

- **Clean Architecture**: Layered architecture with clear separation of concerns
- **Dependency Injection**: Awilix-based DI container for loose coupling
- **Domain-Driven Design**: Rich domain models with encapsulated business logic
- **Event-Driven Communication**: EventBus for decoupled component communication
- **Multi-Instance Support**: Monitor multiple GitHub organizations with different MCP servers
- **Multi-Repository**: Track multiple repositories per instance with independent state management
- **Per-Repo Telegram Threads**: Each repository has its own Telegram thread for organized notifications
- **MCP-First Architecture**: All GitHub operations use OpenClaw MCP tools - no direct GitHub REST API calls
- **AI-Powered Reviews**: Three configurable review levels (Low/Medium/High) with different focus areas
- **Smart Notifications**: Each PR notified up to 3 times with 3-hour skip option per repository
- **Telegram Integration**: Interactive bot with inline buttons for Review, Approve, Reject, Close, and Skip
- **Repository-Scoped State**: All tracking data persisted per repository - survives restarts without duplicates
- **Production-Ready**: Built-in retry logic, error isolation, graceful shutdown, and comprehensive logging
- **90%+ Test Coverage**: Comprehensive unit and integration tests

### Architecture

This project follows **Clean Architecture** principles with clear layer separation:

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
│  │  • ProcessPRUseCase                                  │      │
│  │  • SendNotificationUseCase                           │      │
│  │  • ReviewPRUseCase                                  │      │
│  │  • CheckOutdatedReviewsUseCase                      │      │
│  └──────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │         Orchestrators (Workflow Coordination)      │      │
│  │  • PRProcessingOrchestrator                         │      │
│  └──────────────────────────────────────────────────┘      │
│  ┌──────────────────────────────────────────────────┐      │
│  │         Facade (Unified State Management)           │      │
│  │  • StateCoordinationService                         │      │
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
│  │ • Instance       │  │  • EventBus       │               │
│  └──────────────────┘  └──────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Infrastructure Layer                       │
│  ┌──────────────────┐  ┌──────────────────┐               │
│  │ External Services│  │  State Storage   │               │
│  │ • MCP GitHub     │  │  • FileSystem    │               │
│  │ • Telegram       │  │  • In-Memory     │               │
│  │ • OpenClaw Agent │  │                  │               │
│  └──────────────────┘  └──────────────────┘               │
│  ┌──────────────────────────────────────────────────┐      │
│  │                Adapters (Interface Implementations)     │
│  │  • MCPGitHubAdapter   • TelegramBotAdapter       │      │
│  │  • OpenClawAgentAdapter  • CallbackHandler        │      │
│  └──────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   Cross-Cutting Concerns                    │
│  • Logging (Winston)  • Retry Logic  • Error Handling       │
│  • Configuration      • DI Container • Event Bus            │
└─────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
src/
├── bootstrap/                    # Application initialization
│   └── Bootstrap.js           # Composition root, startup/shutdown
├── core/                         # Domain layer
│   ├── entities/                # Domain entities
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
│       └── StateCoordinationService.js
├── infrastructure/               # Infrastructure layer
│   ├── github/                  # GitHub operations
│   │   └── MCPGitHubAdapter.js
│   ├── telegram/                 # Telegram integration
│   │   ├── TelegramBotAdapter.js
│   │   └── CallbackHandler.js
│   ├── agents/                   # AI agents
│   │   └── OpenClawAgentAdapter.js
│   └── persistence/               # State persistence
│       ├── FileSystemStateRepository.js
│       └── InMemoryStateRepository.js
├── interfaces/                   # Interface definitions
│   ├── IStateRepository.js
│   ├── IGitHubService.js
│   ├── ITelegramService.js
│   └── IAgentService.js
├── shared/                       # Cross-cutting concerns
│   ├── events/                  # Event system
│   │   └── EventBus.js
│   ├── errors/                  # Error types
│   │   ├── DomainError.js
│   │   ├── ConfigurationError.js
│   │   └── MCPError.js
│   ├── utils/                   # Shared utilities
│   │   ├── RetryHelper.js
│   │   └── TimeoutManager.js
│   └── logging/                 # Logging
│       └── LoggerFactory.js
├── container/                    # DI container
│   ├── Container.js
│   └── bindings.js
├── config/                       # Configuration
│   └── yamlConfig.js
└── services/                     # Legacy services (being phased out)
```

### Core Services

| Layer | Service | Responsibility |
|-------|---------|---------------|
| **Domain** | PRAnalyzerService | Analyzes PR risk, impact area, and suspicious patterns |
| **Domain** | RiskCalculatorService | Calculates risk levels based on size and patterns |
| **Domain** | PRStateMachine | Manages PR state transitions with validation |
| **Application** | ProcessPRUseCase | Orchestrates end-to-end PR processing workflow |
| **Application** | SendNotificationUseCase | Handles Telegram notification formatting |
| **Application** | ReviewPRUseCase | Coordinates AI review submission |
| **Application** | CheckOutdatedReviewsUseCase | Detects outdated reviews |
| **Application** | PRProcessingOrchestrator | Main workflow coordinator |
| **Application** | StateCoordinationService | Unified state management facade |
| **Infrastructure** | MCPGitHubAdapter | GitHub operations via MCP |
| **Infrastructure** | TelegramBotAdapter | Telegram bot management |
| **Infrastructure** | OpenClawAgentAdapter | AI review execution |

## Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **npm** package manager
- **OpenClaw MCP** installed and configured
- **mcporter** CLI tool for MCP server management
- **Telegram Bot** created via [@BotFather](https://t.me/botfather)
- **PM2** (recommended for production)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd agent-pr

# Install dependencies
npm install

# Create configuration file
cp config.yml.example config.yml

# Edit config.yml with your settings
nano config.yml
```

### Configuration

The daemon uses `config.yml` for configuration. See `config.yml.example` for the template.

**Key Configuration Options:**

| Setting | Description | Default |
|---------|-------------|---------|
| `app.check_interval_minutes` | Polling frequency in minutes | 7 |
| `app.telegram.bot_token` | Telegram bot token from @BotFather | Required |
| `app.telegram.chat_id` | Main Telegram chat ID | Required |
| `{instance}.mcp_name` | MCP server name for this instance | Required |
| `{instance}.max_age_hours` | Maximum PR age to process | 48 |
| `{repos}.{repo}.thread_id` | Telegram thread ID for this repo | Required |

### Running the Application

```bash
# Development mode (auto-restart)
npm run dev

# Production
npm start

# With PM2 (recommended)
pm2 start ecosystem.config.js
```

## Development

### Project Structure

The project follows Clean Architecture principles with these key directories:

- **`src/core/`** - Domain entities and business logic
- **`src/application/`** - Use cases and orchestrators
- **`src/infrastructure/``** - External service adapters
- **`src/container/``** - Dependency injection container
- **`src/shared/``** - Cross-cutting concerns

### Adding Features

1. **New Domain Entity**: Create in `src/core/entities/`
2. **New Use Case**: Create in `src/application/use-cases/`
3. **New Adapter**: Implement interface in `src/infrastructure/`
4. **New Event**: Emit via EventBus

### Testing

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test suite
npm test -- --testPathPatterns="integration"
```

## License

MIT License - see LICENSE file for details
