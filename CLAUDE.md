# CLAUDE.md - SchemaGit

## Project Overview
SchemaGit is a version control system for database schemas, allowing branching, diffing, and merging of MySQL schemas.

## Build & Run
- **Backend:** `cd server && npm install && npm run dev`
- **Frontend:** `cd client && npm install && npm run dev`

## Guidelines
- **Naming:** CamelCase for variables, PascalCase for components.
- **Code Style:** Prefer functional components and hooks in React. Use async/await for all database operations in Node.js.
- **Testing:** Use Jest for backend logic and React Testing Library for frontend.
- **Architecture:** 
  - `server/src/engine`: The core schema diffing and DDL generation logic.
  - `server/src/api`: REST endpoints.
  - `client/src/components`: Reusable UI elements.
  - `client/src/pages`: Page-level views.