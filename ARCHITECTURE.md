# Architecture - SchemaGit

SchemaGit is a version control system for database schemas. It allows developers to branch, evolve, and merge database schemas with a strong emphasis on real-database verification.

## System Overview

The system is split into three primary logical domains:
1. **Metadata Store (`schemagit` DB):** Tracks the version graph (Projects $\rightarrow$ Branches $\rightarrow$ Commits $\rightarrow$ Snapshots).
2. **Project Databases:** Isolated TiDB/MySQL databases where the actual user schemas reside.
3. **The Engine:** The logic that parses SQL, diffs schemas, and executes migrations.

## High-Level Architecture

```
[ Frontend (React) ] 
       │
       ▼
[ Backend (Node.js/Express) ] ──────► [ Metadata DB (Prisma) ]
       │
       │ (Provisioning / Execution)
       ▼
[ Project Databases (TiDB/MySQL) ]
```

## Core Components

### 1. Metadata Store (The "Git" Layer)
Stored in the `schemagit` database.
- **Project:** The root container. Stores the connection string to the target environment.
- **Branch:** A pointer to a specific `Commit` (the HEAD).
- **Commit:** A snapshot of the schema at a point in time, linked to a parent commit to form a DAG.
- **SchemaSnapshot:** A normalized JSON representation of the entire database schema.

### 2. The Schema Engine (The "Diff" Layer)
- **SQL Parser:** Converts raw SQL dumps into the normalized JSON format.
- **Diff Engine:** Performs semantic comparison between two JSON snapshots.
- **Merge Engine:** Implements a three-way merge algorithm (Base $\rightarrow$ A, Base $\rightarrow$ B) to resolve divergent changes.

### 3. The Execution Engine (The "Physical" Layer)
Handles the translation of semantic changes into physical DDL.
- **Migration Planner:** Converts a `Diff` into a sequence of ordered SQL statements.
- **Executor:** Runs DDL against the project database.
- **OSC (Online Schema Change):** For high-risk operations on large tables, it uses a shadow-table copy pattern to prevent locking.
- **Verifier:** (Planned) Validates that the post-migration `INFORMATION_SCHEMA` matches the target JSON snapshot.

## Data Flow: The Verified Migration Pipeline

To ensure reliability, SchemaGit follows a strict pipeline for any schema change:

1. **Request:** User requests a change (e.g., "Add Column").
2. **Validate:** Backend checks if the operation is valid for the current state.
3. **Plan:** Generate a migration plan (SQL statements) and a "Preview" for the user.
4. **Execute:** Apply the SQL to the Project Database.
5. **Verify:** Query the real database state $\rightarrow$ Compare with expected JSON snapshot.
6. **Commit:** If and only if verification succeeds, create a new `Commit` in the metadata store and update the `Branch` head.

## Database Isolation Model

To prevent pollution and ensure safety:
- **Metadata Isolation:** Tracking data is strictly separated from user data.
- **Project Isolation:** Each project is provisioned as a separate database (`CREATE DATABASE \`project_id\``).
- **Branch Strategy:** Currently, one physical database per project is used. Switching branches is handled by applying the diff between the current HEAD and the target HEAD.
