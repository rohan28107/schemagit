# Decisions Log - SchemaGit

This file tracks the architectural and product decisions made during the development of SchemaGit.

## Project Setup
- **Decision:** Separate `server` and `client` directories.
- **Reasoning:** Clear separation of concerns and allows for independent scaling/deployment.
- **Alternatives:** Monolith with a shared build process.
- **Tradeoff:** Slightly more overhead in managing two package.json files.

## Technology Stack
- **Decision:** React + Tailwind CSS for Frontend.
- **Reasoning:** Industry standard for fast, iterative UI development. Tailwind allows for rapid prototyping of a professional "DevTool" look.
- **Decision:** Node.js + Express for Backend.
- **Reasoning:** Excellent ecosystem for I/O heavy tasks (handling SQL dumps) and integrates seamlessly with Prisma.
- **Decision:** MySQL for both Metadata and Target DB.
- **Reasoning:** The problem statement specifically mentions MySQL-like behaviors (DBeaver, 5GB tables). Using the same engine for metadata simplifies the environment.
- **Decision:** Prisma for Metadata ORM.
- **Reasoning:** Provides type-safety for the version graph and easy migrations for the app's own internal state.

## Schema Engine
- **Decision:** JSON-based Schema Representation.
- **Reasoning:** Instead of storing raw SQL, we store a structured JSON representation of the schema. This makes diffing and merging an object-comparison problem rather than a text-parsing problem.
- **Decision:** Regex-based SQL Parser for imports.
- **Reasoning:** To support "importing from DBeaver," we needed a way to bootstrap the state. A custom regex parser handles standard `CREATE TABLE` statements without requiring a full SQL grammar.

## Execution & Scaling
- **Decision:** `ALGORITHM=INSTANT` for large tables.
- **Reasoning:** To solve the 5GB constraint, we leverage MySQL 8.0's instant DDL. This avoids full table copies for many common operations (like adding columns), preventing massive locks.
- **Decision:** Size-Aware Execution Path.
- **Reasoning:** The `ExecutionEngine` checks `INFORMATION_SCHEMA` before applying changes. This allows the system to warn users or switch to a shadow-table copy strategy (like gh-ost) for high-risk operations on huge datasets.
