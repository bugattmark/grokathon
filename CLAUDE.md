# CLAUDE.md - Project Guidelines

## Testing

- For every feature implemented, add robust tests that cover all test cases
- Review existing tests before adding new ones to understand current coverage and patterns
- Build on top of existing test infrastructure rather than creating parallel structures
- Test edge cases, error conditions, and happy paths

## Architecture

- Keep modules small and single-purpose
- Separate concerns: data, logic, and presentation
- Prefer composition over inheritance
- Design for testability - inject dependencies

## Code Quality

- Follow existing code patterns and conventions in the codebase
- No dead code or commented-out code in commits

## Git

- Write clear, concise commit messages that explain the "why"
- Keep commits atomic - one logical change per commit
