const express = require("express");
const router = express.Router();
const { PrismaClient } = require("@prisma/client");
const SQLParser = require("../engine/sqlParser");
const SchemaEngine = require("../engine/schemaEngine");
const ExecutionEngine = require("../engine/executionEngine");
const ConnectionManager = require("../utils/connectionManager");
const ConflictService = require("../services/ConflictService");
const multer = require("multer");

const prisma = new PrismaClient();
const upload = multer();

router.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "SchemaGit API is running",
  });
});

// Create a new project from a SQL dump
router.post("/import", upload.single("sqlFile"), async (req, res) => {
  try {
    const { name } = req.body;
    let sql = req.body.sql;

    if (req.file) {
      sql = req.file.buffer.toString("utf8");
    }

    if (!sql) {
      return res.status(400).json({
        error:
          "No SQL content provided. Please upload a .sql file or provide the sql string.",
      });
    }

    // 1. Generate a unique database name for the project
    const projectId = require('crypto').randomUUID();
    const dbName = `schemagit_project_${projectId.substring(0, 8)}`;

    // 2. Use Admin connection to create the physical database
    const adminUrl = process.env.TIDB_ADMIN_URL;
    if (!adminUrl) {
      console.error('[Import] TIDB_ADMIN_URL is not configured');
      return res.status(500).json({ error: "Server configuration error: Admin URL missing" });
    }

    // 3. Build the project-specific connection string
    const url = new URL(adminUrl);
    const projectConnectionString = `${url.protocol}//${url.username}:${url.password}@${url.hostname}:${url.port}/${dbName}`;

    // Provision project record first to track status
    const project = await prisma.project.create({
      data: {
        id: projectId,
        name,
        connectionString: projectConnectionString,
        status: 'PROVISIONING',
      },
    });

    const adminConn = await ConnectionManager.getConnection(adminUrl);
    try {
      await adminConn.execute(`CREATE DATABASE IF NOT EXISTS \`${dbName}\`;`);
      console.log(`[Import] Provisioned database: ${dbName}`);
    } finally {
      await ConnectionManager.closeConnection(adminConn);
    }


    // Update status to IMPORTING
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'IMPORTING' },
    });

    // 4. Execute the imported SQL against the new database to initialize it
    const projectConn = await ConnectionManager.getConnection(projectConnectionString);
    try {
      // We execute the raw SQL to create the initial tables
      // Note: In a production environment, we'd split the SQL into statements
      // For now, we assume the SQL is a valid dump.
      await projectConn.query(sql);
      console.log(`[Import] Initial schema executed for ${dbName}`);
    } catch (e) {
      console.error('[Import] SQL Execution failed:', e.message);
      // We continue, but let the user know it might need 'Apply'
    } finally {
      await ConnectionManager.closeConnection(projectConn);
    }

    // Update status to VERIFYING
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'VERIFYING' },
    });

    // 5. Verify the physical state against the metadata
    const verifyConn = await ConnectionManager.getConnection(projectConnectionString);
    try {
      const currentState = await SchemaEngine.getCurrentDbState(verifyConn);
      const snapshotContent = SQLParser.parse(sql);
      const verification = SchemaEngine.verify(currentState, snapshotContent);

      if (!verification.isVerified) {
        console.warn(`[Import] Verification mismatch detected: ${JSON.stringify(verification.diff)}`);
      }
    } finally {
      await ConnectionManager.closeConnection(verifyConn);
    }

    // 6. Create metadata in schemagit
    const snapshotContent = SQLParser.parse(sql);

    const snapshot = await prisma.schemaSnapshot.create({
      data: { content: snapshotContent },
    });

    const mainBranch = await prisma.branch.create({
      data: {
        name: "main",
        projectId: project.id,
      },
    });

    const initialCommit = await prisma.commit.create({
      data: {
        message: "Initial import",
        snapshotId: snapshot.id,
        branchId: mainBranch.id,
      },
    });

    await prisma.branch.update({
      where: { id: mainBranch.id },
      data: { headId: initialCommit.id },
    });

    // Final status: READY
    await prisma.project.update({
      where: { id: projectId },
      data: { status: 'READY' },
    });

    const projectWithBranches = await prisma.project.findUnique({
      where: { id: project.id },
      include: { branches: true },
    });

    res.json({
      project: projectWithBranches,
      branch: mainBranch,
      provisionedDb: dbName
    });
  } catch (error) {
    console.error('[Import Error] Detailed:', error);

    // Mark project as FAILED if it was created
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { status: 'FAILED' },
      });
    } catch (e) {
      // project might not have been created yet
    }

    res.status(500).json({ error: "Failed to import schema", details: error.message });
  }

});

// Diff two branches

router.get("/diff", async (req, res) => {
  const { branchA, branchB } = req.query;
  console.log(
    `[Diff] Request received: branchA=${branchA}, branchB=${branchB}`,
  );
  try {
    const bA = await prisma.branch.findUnique({
      where: { id: branchA },
      include: { head: { include: { snapshot: true } } },
    });
    const bB = await prisma.branch.findUnique({
      where: { id: branchB },
      include: { head: { include: { snapshot: true } } },
    });

    if (!bA || !bB) {
      console.log("[Diff] Error: One or both branches not found");
      return res.status(404).json({ error: "One or both branches not found" });
    }

    if (!bA.head || !bB.head) {
      console.log("[Diff] Error: One or both branches have no commits");
      return res
        .status(400)
        .json({ error: "One or both branches have no commits" });
    }

    if (!bA.head.snapshot || !bB.head.snapshot) {
      console.log("[Diff] Error: One or both snapshots are missing");
      return res
        .status(400)
        .json({ error: "One or both snapshots are missing" });
    }

    const contentA = bA.head.snapshot.content;
    const contentB = bB.head.snapshot.content;

    if (contentA === null || contentB === null) {
      console.log("[Diff] Error: One or both snapshot contents are null");
      return res
        .status(400)
        .json({ error: "One or both snapshot contents are null" });
    }

    console.log("[Diff] Calculating diff...");
    const diff = SchemaEngine.diff(contentA, contentB);

    const response = { diff };
    console.log("[Diff] Success. Response:", JSON.stringify(response));
    res.json(response);
  } catch (error) {
    console.error("[Diff] Critical error:", error);
    res.status(500).json({ error: "Diff failed", details: error.message });
  }
});

// Export a branch's schema to a .sql file
router.get("/export", async (req, res) => {
  const { branchId } = req.query;
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: { head: { include: { snapshot: true } } },
    });

    if (!branch || !branch.head || !branch.head.snapshot) {
      return res.status(404).json({ error: "Branch or snapshot not found" });
    }

    const snapshot = branch.head.snapshot.content;
    const sql = SchemaEngine.generateFullSchemaSQL(snapshot);

    res.attachment("schema_export.sql");
    res.send(sql);
  } catch (error) {
    console.error("[Export] Critical error:", error);
    res.status(500).json({ error: "Export failed", details: error.message });
  }
});

// Get project details and current head
router.get("/:id", async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        branches: {
          include: { head: { include: { snapshot: true } } },
        },
      },
    });
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch project" });
  }
});

// Create a new branch
router.post("/branch", async (req, res) => {
  const { name, projectId, sourceBranchId } = req.body;
  try {
    if (!sourceBranchId) {
      return res.status(400).json({ error: "sourceBranchId is required" });
    }

    const sourceBranch = await prisma.branch.findUnique({
      where: { id: sourceBranchId },
      include: { head: true },
    });

    if (!sourceBranch) {
      return res.status(404).json({ error: "Source branch not found" });
    }

    const newBranch = await prisma.branch.create({
      data: {
        name,
        projectId,
        headId: sourceBranch.headId ? sourceBranch.headId : null,
      },
    });

    res.json(newBranch);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create branch" });
  }
});

// Commit a change to a branch
router.post("/commit", async (req, res) => {
  const { branchId, message, snapshot } = req.body;
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: { project: true }
    });
    const parentId = branch.headId;

    // Handle both raw SQL strings and pre-parsed snapshot objects
    const parsedSnapshot = typeof snapshot === 'string'
      ? SQLParser.parse(snapshot)
      : snapshot;
    const snapshotRecord = await prisma.schemaSnapshot.create({
      data: { content: parsedSnapshot },
    });

    const commit = await prisma.commit.create({
      data: {
        message,
        snapshotId: snapshotRecord.id,
        branchId,
        parentId,
      },
    });

    await prisma.branch.update({
      where: { id: branchId },
      data: { headId: commit.id },
    });

    res.json(commit);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to commit change" });
  }
});

// Merge one branch into another
router.post("/merge", async (req, res) => {
  const { sourceBranchId, targetBranchId } = req.body;
  try {
    const sourceBranch = await prisma.branch.findUnique({
      where: { id: sourceBranchId },
      include: { head: { include: { snapshot: true } } },
    });
    const targetBranch = await prisma.branch.findUnique({
      where: { id: targetBranchId },
      include: { head: { include: { snapshot: true } } },
    });

    if (!sourceBranch || !targetBranch) {
      return res.status(404).json({ error: "One or both branches not found" });
    }

    if (!sourceBranch.head?.snapshot || !targetBranch.head?.snapshot) {
      return res
        .status(400)
        .json({ error: "One or both branches have no commits" });
    }

    const sourceSnapshot = sourceBranch.head.snapshot.content;
    const targetSnapshot = targetBranch.head.snapshot.content;

    // 1. Find Common Ancestor (LCA) for Three-Way Merge
    let baseSnapshot = null;
    const sourceCommits = await prisma.commit.findMany({
      where: { branchId: sourceBranchId },
      orderBy: { createdAt: 'desc' }
    });
    const targetCommits = await prisma.commit.findMany({
      where: { branchId: targetBranchId },
      orderBy: { createdAt: 'desc' }
    });

    const sourceCommitIds = new Set(sourceCommits.map(c => c.id));
    for (const commit of targetCommits) {
      if (sourceCommitIds.has(commit.id)) {
        const ancestorSnapshot = await prisma.schemaSnapshot.findUnique({
          where: { id: commit.snapshotId }
        });
        baseSnapshot = ancestorSnapshot?.content;
        break;
      }
    }

    // Fallback: if no common ancestor, base is empty
    if (!baseSnapshot) baseSnapshot = {};

    // 2. Use ConflictService for Three-Way Merge
    const { mergedSchema, conflicts } = ConflictService.detectConflicts(
      baseSnapshot,
      sourceSnapshot,
      targetSnapshot
    );

    const mergeMessage = `Merged branch ${sourceBranch.name} into ${targetBranch.name}`;

    if (conflicts.length > 0) {
      return res.status(409).json({
        error: "Merge conflicts detected",
        conflicts,
        mergedSnapshot: mergedSchema,
      });
    }

    const snapshotRecord = await prisma.schemaSnapshot.create({
      data: { content: mergedSchema },
    });

    const commit = await prisma.commit.create({
      data: {
        message: mergeMessage,
        snapshotId: snapshotRecord.id,
        branchId: targetBranchId,
        parentId: targetBranch.headId,
      },
    });

    await prisma.branch.update({
      where: { id: targetBranchId },
      data: { headId: commit.id },
    });

    res.json({
      message: `Successfully merged ${sourceBranch.name} into ${targetBranch.name}`,
      commit: commit,
    });
  } catch (error) {
    console.error("[Merge] Critical error:", error);
    res.status(500).json({ error: "Merge failed", details: error.message });
  }
});

// Resolve merge conflicts and finalize merge
router.post("/resolve", async (req, res) => {
  const { sourceBranchId, targetBranchId, resolutions } = req.body;
  try {
    const sourceBranch = await prisma.branch.findUnique({
      where: { id: sourceBranchId },
      include: { head: { include: { snapshot: true } } },
    });
    const targetBranch = await prisma.branch.findUnique({
      where: { id: targetBranchId },
      include: { head: { include: { snapshot: true } } },
    });

    if (!sourceBranch || !targetBranch) {
      return res.status(404).json({ error: "One or both branches not found" });
    }

    const sourceSnapshot = sourceBranch.head.snapshot.content;
    const targetSnapshot = targetBranch.head.snapshot.content;

    // Re-calculate the merge to get the mergedSchema and conflicts
    let baseSnapshot = null;
    const sourceCommits = await prisma.commit.findMany({
      where: { branchId: sourceBranchId },
      orderBy: { createdAt: 'desc' }
    });
    const targetCommits = await prisma.commit.findMany({
      where: { branchId: targetBranchId },
      orderBy: { createdAt: 'desc' }
    });

    const sourceCommitIds = new Set(sourceCommits.map(c => c.id));
    for (const commit of targetCommits) {
      if (sourceCommitIds.has(commit.id)) {
        const ancestorSnapshot = await prisma.schemaSnapshot.findUnique({
          where: { id: commit.snapshotId }
        });
        baseSnapshot = ancestorSnapshot?.content;
        break;
      }
    }
    if (!baseSnapshot) baseSnapshot = {};

    const { mergedSchema, conflicts } = ConflictService.detectConflicts(
      baseSnapshot,
      sourceSnapshot,
      targetSnapshot
    );

    // Apply resolutions to the mergedSchema
    const finalSchema = { ...mergedSchema };

    if (Array.isArray(resolutions)) {
      resolutions.forEach((resolution, index) => {
        const conflict = conflicts[index];
        if (!conflict) return;

        if (conflict.type === 'TABLE_CONFLICT') {
          finalSchema[conflict.table] = resolution;
        } else if (conflict.type === 'COLUMN_CONFLICT') {
          const table = conflict.table;
          const colName = conflict.column;
          if (finalSchema[table]) {
            const updatedCols = finalSchema[table].columns.map(col =>
              col.name.toLowerCase() === colName.toLowerCase() ? resolution : col
            );
            finalSchema[table] = { ...finalSchema[table], columns: updatedCols };
          }
        }
      });
    } else if (resolutions && typeof resolutions === 'object') {
      Object.entries(resolutions).forEach(([index, resolution]) => {
        const conflict = conflicts[parseInt(index)];
        if (!conflict) return;

        if (conflict.type === 'TABLE_CONFLICT') {
          finalSchema[conflict.table] = resolution;
        } else if (conflict.type === 'COLUMN_CONFLICT') {
          const table = conflict.table;
          const colName = conflict.column;
          if (finalSchema[table]) {
            const updatedCols = finalSchema[table].columns.map(col =>
              col.name.toLowerCase() === colName.toLowerCase() ? resolution : col
            );
            finalSchema[table] = { ...finalSchema[table], columns: updatedCols };
          }
        }
      });
    }

    const snapshotRecord = await prisma.schemaSnapshot.create({
      data: { content: finalSchema },
    });

    const commit = await prisma.commit.create({
      data: {
        message: `Resolved merge conflicts from ${sourceBranch.name} into ${targetBranch.name}`,
        snapshotId: snapshotRecord.id,
        branchId: targetBranchId,
        parentId: targetBranch.headId,
      },
    });

    await prisma.branch.update({
      where: { id: targetBranchId },
      data: { headId: commit.id },
    });

    res.json({
      message: "Conflicts resolved and merged successfully",
      commit: commit,
    });
  } catch (error) {
    console.error("[Resolve] Critical error:", error);
    res.status(500).json({ error: "Failed to resolve conflicts", details: error.message });
  }
});

// Apply changes to the real database
router.post("/apply", async (req, res) => {
  const { branchId } = req.body;
  try {
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      include: {
        head: { include: { snapshot: true } },
        project: true
      },
    });

    if (!branch || !branch.head || !branch.head.snapshot) {
      return res.status(404).json({ error: "Branch or snapshot not found" });
    }

    // --- CONCURRENCY LOCK ---
    const project = branch.project;
    if (project.status !== 'READY') {
      return res.status(409).json({
        error: "Concurrency Conflict",
        message: "Another schema migration is currently running for this project."
      });
    }

    try {
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'VERIFYING' },
      });
    } catch (e) {
      // Handle case where another request just snatched the lock
      return res.status(409).json({
        error: "Concurrency Conflict",
        message: "Another schema migration is currently running for this project."
      });
    }
    // -------------------------

    console.log(`[Apply] Applying branch ${branchId} to database...`);

    let targetDb;
    try {
      targetDb = await ConnectionManager.getConnection(project.connectionString);

      // 1. Get actual current DB state
      const currentDbState = await SchemaEngine.getCurrentDbState(targetDb);

      // 2. Generate a structured migration plan
      const diff = SchemaEngine.diff(
        currentDbState,
        branch.head.snapshot.content,
      );
      const plan = SchemaEngine.generateMigrationPlan(
        diff,
        branch.head.snapshot.content,
      );

      if (plan.length === 0) {
        await prisma.project.update({
          where: { id: project.id },
          data: { status: 'READY' },
        });
        return res.json({ message: "Database is already up to date", plan: [] });
      }

      // 3. Execute the migration plan (handling large tables automatically)
      const results = await ExecutionEngine.executeMigrationPlan(plan, targetDb);

      // 4. VERIFY: Compare real DB state after migration with the target snapshot
      const postMigrationState = await SchemaEngine.getCurrentDbState(targetDb);
      const verification = SchemaEngine.verify(postMigrationState, branch.head.snapshot.content);

      if (!verification.isVerified) {
        console.error("[Apply] Verification failed. Full Diff:", JSON.stringify(verification.diff, null, 2));
        throw new Error(`Verification failed: The database was updated, but the resulting state does not match the commit snapshot.`);
      }

      res.json({
        message: "Schema applied and verified successfully",
        appliedSteps: results.length,
        details: results,
      });

    } finally {
      if (targetDb) {
        await ConnectionManager.closeConnection(targetDb);
      }
      // Always reset status
      await prisma.project.update({
        where: { id: project.id },
        data: { status: 'READY' },
      });
    }
  } catch (error) {
    console.error("[Apply] Critical error:", error);

    // Try to reset project status to READY or FAILED on error
    try {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        include: { project: true }
      });
      if (branch?.project) {
        await prisma.project.update({
          where: { id: branch.project.id },
          data: { status: 'FAILED' },
        });
      }
    } catch (resetError) {
      console.error("[Apply] Failed to reset project status:", resetError.message);
    }

    res
      .status(500)
      .json({ error: "Failed to apply schema", details: error.message });
  }
});

module.exports = router;
