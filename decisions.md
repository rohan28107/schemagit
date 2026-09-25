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
- **Alternatives:** 
    - **Raw SQL**: Text diffs are noisy, unreliable for semantic changes, and cannot easily be merged.
    - **Full SQL AST**: Providing a full AST is the "gold standard" but would be over-engineering for a 5-day scope; JSON provides 90% of the value with 10% of the complexity.
- **Decision:** Regex-based SQL Parser for imports.
- **Reasoning:** To support "importing from DBeaver," we needed a way to bootstrap the state. A custom regex parser handles standard `CREATE TABLE` statements without requiring a full SQL grammar.

## Execution & Scaling
- **Decision:** `ALGORITHM=INSTANT` for large tables.
- **Reasoning:** To solve the 5GB constraint, we leverage MySQL 8.0's instant DDL. This avoids full table copies for many common operations (like adding columns), preventing massive locks.
- **Decision:** Size-Aware Execution Path.
- **Reasoning:** The `ExecutionEngine` checks `INFORMATION_SCHEMA` before applying changes. This allows the system to warn users or switch to a shadow-table copy strategy (like gh-ost) for high-risk operations on huge datasets.

## Migration Reliability
- **Decision:** Verified Migration Pipeline.
- **Reasoning:** To ensure the metadata store never drifts from the actual database, we implement a "Verify-before-Commit" loop. A commit is only recorded if the post-migration database state matches the expected snapshot.
- **Alternatives:** Trusting the DDL execution result (which can be misleading) or periodic full-syncs.
- **Tradeoff:** Increased latency per commit due to the verification query, but significantly higher reliability.

## Database Isolation
- **Decision:** One physical database per project.
- **Reasoning:** Isolates users' schemas completely. While a database-per-branch would be safer, it would increase provisioning overhead and cost for a take-home assessment. We handle branch switching via sequential migrations.
- **Alternatives:** 
    - **Schema-per-branch**: Too many schemas in one DB.
    - **Database-per-branch**: Too expensive/slow to provision.
- **Tradeoff:** Switching branches requires executing DDL, which takes time for large tables.

## Merge Semantics
- **Decision:** Three-Way Merge (Base $\rightarrow$ Source $\rightarrow$ Target).
- **Reasoning:** A two-way merge cannot distinguish between "added in A" and "dropped in B." A three-way merge allows us to detect divergent changes accurately.
- **Tradeoff:** Requires tracking the Common Ancestor (LCA), which adds complexity to the commit graph traversal.

## Deliberate Omissions
To focus on the core "5GB Table" and "Versioning" requirements within the 5-day window, the following were consciously cut:
- **Full SQL Grammar Support**: Using a regex parser instead of a formal grammar to prioritize the execution engine.
- **Multi-user RBAC**: No roles or permissions; assumed single-tenant project access.
- **Stored Procedures & Triggers**: Omitted from the schema snapshot to focus on table and column evolution.
- **Advanced Concurrency Controls**: Omitted distributed locking for `/apply` to focus on the OSC implementation.
