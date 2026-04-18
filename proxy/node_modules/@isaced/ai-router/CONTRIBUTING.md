# Contributing to ai-router 🤖🔄

Thank you for your interest in contributing to ai-router! We welcome
contributions of all kinds, from bug reports and feature requests to code
improvements and documentation updates.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Contributing Guidelines](#contributing-guidelines)
- [Submitting Changes](#submitting-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Documentation](#documentation)
- [Community](#community)

## Code of Conduct

By participating in this project, you agree to abide by our Code of Conduct.
Please treat all community members with respect and create a welcoming
environment for everyone.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) (recommended) or Node.js 18+
- Git
- A GitHub account

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-router.git
   cd ai-router
   ```
3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/isaced/ai-router.git
   ```

## Development Setup

1. Install dependencies:
   ```bash
   bun install
   ```

2. Run tests to ensure everything works:
   ```bash
   bun test
   ```

3. Start developing! The project structure is:
   ```
   src/
   ├── AIRouter.ts          # Main router class
   ├── index.ts             # Public exports
   ├── core/                # Core functionality
   ├── types/               # TypeScript type definitions
   └── utils/               # Utility functions
   test/                    # Test files
   examples/                # Usage examples
   ```

## Contributing Guidelines

### Types of Contributions

We welcome:

- 🐛 **Bug fixes**: Fix issues or unexpected behavior
- ✨ **New features**: Add support for new providers, middleware, or
  functionality
- 📚 **Documentation**: Improve README, add examples, or write guides
- 🧪 **Tests**: Add test coverage or improve existing tests
- 🔧 **Improvements**: Performance optimizations, code refactoring
- 🎨 **Examples**: Add new usage examples or improve existing ones

### Before You Start

1. **Check existing issues**: Look for existing issues or discussions related to
   your contribution
2. **Open an issue**: For significant changes, please open an issue first to
   discuss your approach
3. **Keep it focused**: Each pull request should address a single concern

### Provider Support

When adding support for new AI providers:

1. Follow the existing provider pattern in `src/core/providers.ts`
2. Ensure proper error handling and response formatting
3. Add comprehensive tests
4. Update documentation with usage examples
5. Consider rate limiting and authentication requirements

### Middleware Development

For new middleware:

1. Follow the middleware interface in `src/types/middleware.ts`
2. Ensure middleware is composable and doesn't break the chain
3. Add tests for both success and error scenarios
4. Document usage patterns and configuration options

## Submitting Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-claude-provider`
- `fix/rate-limit-calculation`
- `docs/update-readme-examples`
- `test/improve-failover-coverage`

### Commit Messages

Follow conventional commit format:

```
type(scope): description

[optional body]

[optional footer]
```

Examples:

- `feat(providers): add support for Anthropic Claude`
- `fix(router): handle timeout errors correctly`
- `docs(readme): update installation instructions`
- `test(core): add tests for load balancing`

### Pull Request Process

1. **Update your fork**:
   ```bash
   git fetch upstream
   git checkout main
   git merge upstream/main
   ```

2. **Create a feature branch**:
   ```bash
   git checkout -b feature/your-feature-name
   ```

3. **Make your changes and commit**:
   ```bash
   git add .
   git commit -m "feat: your descriptive commit message"
   ```

4. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```

5. **Open a Pull Request** on GitHub with:
   - Clear title and description
   - Reference to related issues
   - Screenshots/examples if applicable
   - Test results

### Pull Request Checklist

- [ ] Code follows the project's style guidelines
- [ ] Tests pass locally (`bun test`)
- [ ] New tests added for new functionality
- [ ] Documentation updated if needed
- [ ] No breaking changes (or clearly documented)
- [ ] Commit messages follow conventional format

## Testing

### Running Tests

```bash
# Run all tests
bun test

# Run specific test files
bun test test/AIRouter.chat.test.ts

# Run tests in watch mode
bun test --watch
```

### Writing Tests

- Place test files in the `test/` directory
- Use descriptive test names
- Test both success and error scenarios
- Mock external API calls
- Follow the existing test patterns

Example test structure:

```typescript
import { describe, expect, it } from "bun:test";
import { AIRouter } from "../src/AIRouter";

describe("AIRouter", () => {
  it("should route requests correctly", () => {
    // Test implementation
  });
});
```

## Code Style

### TypeScript Guidelines

- Use TypeScript for all new code
- Define proper types and interfaces
- Avoid `any` types when possible
- Export types from `src/types/`

### General Guidelines

- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Handle errors gracefully
- Follow existing code patterns

### Formatting

The project uses standard TypeScript/JavaScript formatting. Please ensure your
code is properly formatted before submitting.

## Documentation

### README Updates

When adding new features:

- Update the features list if applicable
- Add usage examples
- Update the API documentation section

### JSDoc Comments

Add JSDoc comments for:

- Public classes and methods
- Complex functions
- Type definitions
- Configuration options

Example:

```typescript
/**
 * Routes AI requests across multiple providers with load balancing and failover.
 * @param config - Router configuration options
 * @returns Promise resolving to the AI response
 */
```

### Examples

When adding new functionality, consider adding an example to the `examples/`
directory showing how to use it.

## Community

### Getting Help

- 📖 Check the [README](README.md) for basic usage
- 🐛 Open an issue for bugs or feature requests
- 💬 Start a discussion for questions or ideas

### Reporting Issues

When reporting bugs, please include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment details (Node.js version, OS, etc.)
- Minimal code example if applicable

### Feature Requests

For feature requests, please:

- Describe the use case
- Explain why it would be beneficial
- Provide examples of how it would work
- Consider if it fits the project's scope

## Recognition

Contributors will be recognized in:

- GitHub contributors list
- Release notes for significant contributions
- Project documentation where appropriate

Thank you for contributing to ai-router! 🚀

---

For questions about contributing, please open an issue or start a discussion on
GitHub.
